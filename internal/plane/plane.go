// Package plane reads and writes a Plane workspace over OAuth.
//
// Plane is the source of truth: everything here is held in memory for the
// life of the process and never written to disk or logs (Teaching in
// particular). Only the OAuth token is persisted, in the OS keychain.
package plane

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"golang.org/x/sync/errgroup"
)

// PrivateProjects are shown with a lock and must never be cached to disk.
var PrivateProjects = map[string]bool{"TEACH": true}

// States whose items get their comment thread fetched during sync, so the
// Attention view can say who spoke last.
var threadStates = map[string]bool{"needs review": true, "in debate": true}

type Snapshot struct {
	Connected bool      `json:"connected"`
	Workspace string    `json:"workspace"`
	AppURL    string    `json:"appUrl"`
	Me        Member    `json:"me"`
	Projects  []Project `json:"projects"`
	SyncedAt  time.Time `json:"syncedAt"`
	Error     string    `json:"error"`
}

type Member struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	IsBot bool   `json:"isBot"`
}

type Project struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Identifier string   `json:"identifier"`
	Private    bool     `json:"private"`
	States     []State  `json:"states"`
	Labels     []Label  `json:"labels"`
	Modules    []Module `json:"modules"`
	Cycles     []Cycle  `json:"cycles"`
	Items      []Item   `json:"items"`
}

type State struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Color   string `json:"color"`
	Group   string `json:"group"`
	Default bool   `json:"default"`
}

type Label struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type Module struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

type Cycle struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
}

type Item struct {
	ID         string   `json:"id"`
	ProjectID  string   `json:"projectId"`
	Key        string   `json:"key"`
	Name       string   `json:"name"`
	StateID    string   `json:"stateId"`
	Priority   string   `json:"priority"`
	LabelIDs   []string `json:"labelIds"`
	ModuleIDs  []string `json:"moduleIds"`
	CycleIDs   []string `json:"cycleIds"`
	TargetDate string   `json:"targetDate"`
	CreatedAt  string   `json:"createdAt"`
	UpdatedAt  string   `json:"updatedAt"`
	CreatedBy  string   `json:"createdBy"`
	// Agent is true when the item carries the agent label or the agent has
	// commented on it.
	Agent bool `json:"agent"`
	// Thread fields are filled only for threadStates; CommentCount is -1
	// when unknown.
	CommentCount       int    `json:"commentCount"`
	LastCommentAt      string `json:"lastCommentAt"`
	LastCommentByAgent bool   `json:"lastCommentByAgent"`
}

type ItemDetail struct {
	Item
	DescriptionHTML string     `json:"descriptionHtml"`
	Comments        []Comment  `json:"comments"`
	Activity        []Activity `json:"activity"`
}

type Comment struct {
	ID        string `json:"id"`
	HTML      string `json:"html"`
	CreatedAt string `json:"createdAt"`
	Author    Member `json:"author"`
	Agent     bool   `json:"agent"`
}

type Activity struct {
	ID        string `json:"id"`
	Actor     Member `json:"actor"`
	Verb      string `json:"verb"`
	Field     string `json:"field"`
	OldValue  string `json:"oldValue"`
	NewValue  string `json:"newValue"`
	CreatedAt string `json:"createdAt"`
}

// ItemPatch is a partial update; nil fields are left alone.
type ItemPatch struct {
	Name       *string   `json:"name,omitempty"`
	StateID    *string   `json:"stateId,omitempty"`
	Priority   *string   `json:"priority,omitempty"`
	LabelIDs   *[]string `json:"labelIds,omitempty"`
	TargetDate *string   `json:"targetDate,omitempty"`
}

type NewItem struct {
	ProjectID       string `json:"projectId"`
	Name            string `json:"name"`
	StateID         string `json:"stateId"`
	Priority        string `json:"priority"`
	DescriptionHTML string `json:"descriptionHtml"`
}

type meta struct {
	states     []State
	labels     []Label
	modules    []Module
	cycles     []Cycle
	moduleOf   map[string][]string
	cycleOf    map[string][]string
	fetchedAt  time.Time
	labelNames map[string]string
}

type thread struct {
	updatedAt string
	count     int
	lastAt    string
	lastAgent bool
	anyAgent  bool
	fetchedAt time.Time
}

type Client struct {
	auth *auth
	api  *client

	mu      sync.Mutex
	members map[string]Member
	meta    map[string]*meta
	threads map[string]thread
	me      Member
	last    Snapshot
}

func New() *Client {
	a := &auth{}
	return &Client{
		auth:    a,
		api:     &client{auth: a, bucket: newBucket(40, time.Second)},
		meta:    map[string]*meta{},
		threads: map[string]thread{},
		members: map[string]Member{},
	}
}

func (c *Client) Connected() bool {
	_, err := c.auth.load()
	return err == nil
}

func (c *Client) Workspace() string {
	if t, err := c.auth.load(); err == nil {
		return t.Workspace
	}
	return ""
}

func (c *Client) Connect(ctx context.Context, openURL func(string)) error {
	_, err := c.auth.authorize(ctx, openURL)
	if err == nil {
		c.mu.Lock()
		c.meta = map[string]*meta{}
		c.threads = map[string]thread{}
		c.mu.Unlock()
	}
	return err
}

func (c *Client) Disconnect() error {
	c.mu.Lock()
	c.meta = map[string]*meta{}
	c.threads = map[string]thread{}
	c.members = map[string]Member{}
	c.last = Snapshot{}
	c.mu.Unlock()
	return c.auth.clear()
}

// AppURL is the Plane web UI base, used for "Open in Plane".
func AppURL() string {
	cfg := config.GetConfig()
	if cfg.Plane.AppURL != "" {
		return strings.TrimRight(cfg.Plane.AppURL, "/")
	}
	u, err := url.Parse(cfg.Plane.BaseURL)
	if err != nil || u.Host == "" {
		return "https://app.plane.so"
	}
	if u.Host == "api.plane.so" {
		return "https://app.plane.so"
	}
	return u.Scheme + "://" + u.Host
}

// Last returns the most recent snapshot without hitting the network.
func (c *Client) Last() Snapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.last
}

// Sync fetches every project. Metadata (states, labels, modules, cycles and
// their membership) is refreshed when older than metaTTL or when force is set.
func (c *Client) Sync(ctx context.Context, force bool) (Snapshot, error) {
	snap := Snapshot{Connected: c.Connected(), Workspace: c.Workspace(), AppURL: AppURL()}
	if !snap.Connected {
		return snap, nil
	}
	if err := c.loadMembers(ctx, force); err != nil {
		return c.fail(snap, err)
	}
	projects, err := list[rawProject](ctx, c.api, "/projects/", nil)
	if err != nil {
		return c.fail(snap, err)
	}

	out := make([]Project, 0, len(projects))
	var outMu sync.Mutex
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(3)
	for _, rp := range projects {
		if rp.ArchivedAt != "" {
			continue
		}
		g.Go(func() error {
			p, err := c.syncProject(gctx, rp, force)
			if err != nil {
				return fmt.Errorf("%s: %w", rp.Identifier, err)
			}
			outMu.Lock()
			out = append(out, p)
			outMu.Unlock()
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return c.fail(snap, err)
	}
	sort.Slice(out, func(i, j int) bool { return projectRank(out[i]) < projectRank(out[j]) })

	c.mu.Lock()
	snap.Me = c.me
	c.mu.Unlock()
	snap.Projects = out
	snap.SyncedAt = time.Now()
	c.mu.Lock()
	c.last = snap
	c.mu.Unlock()
	return snap, nil
}

func (c *Client) fail(snap Snapshot, err error) (Snapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if errors.Is(err, ErrNotConnected) {
		snap.Connected = false
	}
	// Keep showing the last good data alongside the error.
	if c.last.Connected && snap.Connected {
		snap = c.last
	}
	snap.Error = err.Error()
	return snap, err
}

// orEmpty keeps JSON arrays as [] rather than null for the frontend.
func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func projectRank(p Project) string {
	order := map[string]string{"WORK": "0", "LAB": "1", "TEACH": "2"}
	if r, ok := order[p.Identifier]; ok {
		return r
	}
	return "9" + p.Identifier
}

const metaTTL = 10 * time.Minute

func (c *Client) loadMembers(ctx context.Context, force bool) error {
	c.mu.Lock()
	have := len(c.members) > 0 && c.me.ID != ""
	c.mu.Unlock()
	if have && !force {
		return nil
	}
	var me rawMember
	if err := c.api.do(ctx, http.MethodGet, "/api/v1/users/me/", nil, &me); err != nil {
		// Not fatal; "me" only drives "your turn" heuristics.
		me = rawMember{}
	}
	members, err := list[rawMember](ctx, c.api, "/members/", nil)
	if err != nil {
		var apiErr *APIError
		if !errors.As(err, &apiErr) {
			return err
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, m := range members {
		c.members[m.ID] = Member{ID: m.ID, Name: m.name(), IsBot: m.IsBot}
	}
	if me.ID != "" {
		c.me = Member{ID: me.ID, Name: me.name()}
	}
	return nil
}

func (c *Client) member(id string, detail *rawMember) Member {
	if detail != nil && detail.ID != "" {
		return Member{ID: detail.ID, Name: detail.name(), IsBot: detail.IsBot}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if m, ok := c.members[id]; ok {
		return m
	}
	return Member{ID: id, Name: "Someone"}
}

func isAgent(m Member) bool {
	name := config.GetConfig().Agent.Name
	return m.IsBot || (name != "" && strings.EqualFold(m.Name, name))
}

func (c *Client) projectMeta(ctx context.Context, pid string, force bool) (*meta, error) {
	c.mu.Lock()
	m := c.meta[pid]
	c.mu.Unlock()
	if m != nil && !force && time.Since(m.fetchedAt) < metaTTL {
		return m, nil
	}
	base := "/projects/" + pid
	states, err := list[rawState](ctx, c.api, base+"/states/", nil)
	if err != nil {
		return nil, err
	}
	labels, err := list[rawLabel](ctx, c.api, base+"/labels/", nil)
	if err != nil {
		return nil, err
	}
	// Modules and cycles can be disabled per project; treat errors as empty.
	modules, _ := list[rawModule](ctx, c.api, base+"/modules/", nil)
	cycles, _ := list[rawCycle](ctx, c.api, base+"/cycles/", nil)

	sort.SliceStable(states, func(i, j int) bool { return states[i].Sequence < states[j].Sequence })
	next := &meta{
		moduleOf:   map[string][]string{},
		cycleOf:    map[string][]string{},
		labelNames: map[string]string{},
		fetchedAt:  time.Now(),
	}
	for _, s := range states {
		next.states = append(next.states, State{ID: s.ID, Name: s.Name, Color: s.Color, Group: s.Group, Default: s.Default})
	}
	for _, l := range labels {
		next.labels = append(next.labels, Label{ID: l.ID, Name: l.Name, Color: l.Color})
		next.labelNames[l.ID] = l.Name
	}
	for _, md := range modules {
		next.modules = append(next.modules, Module{ID: md.ID, Name: md.Name, Status: md.Status})
		rows, err := list[rawMembership](ctx, c.api, base+"/modules/"+md.ID+"/module-issues/", nil)
		if err != nil {
			continue
		}
		for _, r := range rows {
			id := string(r.Issue)
			if id == "" {
				id = r.ID
			}
			next.moduleOf[id] = append(next.moduleOf[id], md.ID)
		}
	}
	today := time.Now().Format("2006-01-02")
	for _, cy := range cycles {
		// Only current and upcoming cycles are useful as a filter.
		if cy.EndDate != "" && cy.EndDate[:min(10, len(cy.EndDate))] < today {
			continue
		}
		next.cycles = append(next.cycles, Cycle{ID: cy.ID, Name: cy.Name, StartDate: cy.StartDate, EndDate: cy.EndDate})
		rows, err := list[rawMembership](ctx, c.api, base+"/cycles/"+cy.ID+"/cycle-issues/", nil)
		if err != nil {
			continue
		}
		for _, r := range rows {
			id := string(r.Issue)
			if id == "" {
				id = r.ID
			}
			next.cycleOf[id] = append(next.cycleOf[id], cy.ID)
		}
	}
	c.mu.Lock()
	c.meta[pid] = next
	c.mu.Unlock()
	return next, nil
}

func (c *Client) syncProject(ctx context.Context, rp rawProject, force bool) (Project, error) {
	m, err := c.projectMeta(ctx, rp.ID, force)
	if err != nil {
		return Project{}, err
	}
	raw, err := list[rawItem](ctx, c.api, "/projects/"+rp.ID+"/work-items/", nil)
	if err != nil {
		return Project{}, err
	}
	stateName := map[string]string{}
	for _, s := range m.states {
		stateName[s.ID] = strings.ToLower(s.Name)
	}
	agentLabel := strings.ToLower(config.GetConfig().Agent.Label)

	p := Project{
		ID: rp.ID, Name: rp.Name, Identifier: rp.Identifier,
		Private: PrivateProjects[strings.ToUpper(rp.Identifier)],
		States:  orEmpty(m.states), Labels: orEmpty(m.labels), Modules: orEmpty(m.modules), Cycles: orEmpty(m.cycles),
		Items: make([]Item, 0, len(raw)),
	}
	for _, ri := range raw {
		if ri.ArchivedAt != "" {
			continue
		}
		it := c.toItem(rp, m, ri)
		for _, l := range it.LabelIDs {
			if agentLabel != "" && strings.ToLower(m.labelNames[l]) == agentLabel {
				it.Agent = true
			}
		}
		if threadStates[stateName[it.StateID]] {
			if th, err := c.thread(ctx, rp.ID, ri); err == nil {
				it.CommentCount, it.LastCommentAt, it.LastCommentByAgent = th.count, th.lastAt, th.lastAgent
				it.Agent = it.Agent || th.anyAgent
			}
		}
		p.Items = append(p.Items, it)
	}
	return p, nil
}

func (c *Client) toItem(rp rawProject, m *meta, ri rawItem) Item {
	it := Item{
		ID: ri.ID, ProjectID: rp.ID,
		Key:  fmt.Sprintf("%s-%d", rp.Identifier, ri.SequenceID),
		Name: ri.Name, StateID: string(ri.State), Priority: ri.Priority,
		TargetDate: ri.TargetDate, CreatedAt: ri.CreatedAt, UpdatedAt: ri.UpdatedAt,
		CommentCount: -1, LabelIDs: []string{},
		ModuleIDs: append([]string{}, m.moduleOf[ri.ID]...), CycleIDs: append([]string{}, m.cycleOf[ri.ID]...),
	}
	if it.Priority == "" {
		it.Priority = "none"
	}
	for _, l := range ri.Labels {
		it.LabelIDs = append(it.LabelIDs, string(l))
	}
	if len(it.ModuleIDs) == 0 {
		for _, md := range ri.ModuleIDs {
			it.ModuleIDs = append(it.ModuleIDs, string(md))
		}
		if ri.Module != "" {
			it.ModuleIDs = append(it.ModuleIDs, string(ri.Module))
		}
	}
	if len(it.CycleIDs) == 0 && ri.Cycle != "" {
		it.CycleIDs = []string{string(ri.Cycle)}
	}
	it.CreatedBy = c.member(string(ri.CreatedBy), ri.CreatedByDetail).Name
	return it
}

// thread summarises an item's comments, cached until the item changes.
func (c *Client) thread(ctx context.Context, pid string, ri rawItem) (thread, error) {
	c.mu.Lock()
	th, ok := c.threads[ri.ID]
	c.mu.Unlock()
	if ok && th.updatedAt == ri.UpdatedAt && time.Since(th.fetchedAt) < 5*time.Minute {
		return th, nil
	}
	comments, err := c.comments(ctx, pid, ri.ID)
	if err != nil {
		return thread{}, err
	}
	th = thread{updatedAt: ri.UpdatedAt, count: len(comments), fetchedAt: time.Now()}
	for _, cm := range comments {
		th.anyAgent = th.anyAgent || cm.Agent
	}
	if n := len(comments); n > 0 {
		th.lastAt, th.lastAgent = comments[n-1].CreatedAt, comments[n-1].Agent
	}
	c.mu.Lock()
	c.threads[ri.ID] = th
	c.mu.Unlock()
	return th, nil
}

func (c *Client) comments(ctx context.Context, pid, id string) ([]Comment, error) {
	raw, err := list[rawComment](ctx, c.api, "/projects/"+pid+"/work-items/"+id+"/comments/", nil)
	if err != nil {
		return nil, err
	}
	out := make([]Comment, 0, len(raw))
	for _, rc := range raw {
		author := rc.ActorDetail
		authorID := string(rc.Actor)
		if authorID == "" {
			authorID = string(rc.CreatedBy)
		}
		m := c.member(authorID, author)
		out = append(out, Comment{ID: rc.ID, HTML: rc.CommentHTML, CreatedAt: rc.CreatedAt, Author: m, Agent: isAgent(m)})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out, nil
}

// Detail fetches one item with description, comments and activity.
func (c *Client) Detail(ctx context.Context, pid, id string) (ItemDetail, error) {
	var ri rawItem
	if err := c.api.do(ctx, http.MethodGet, "/projects/"+pid+"/work-items/"+id+"/", nil, &ri); err != nil {
		return ItemDetail{}, err
	}
	rp, m, err := c.projectFor(ctx, pid)
	if err != nil {
		return ItemDetail{}, err
	}
	d := ItemDetail{Item: c.toItem(rp, m, ri), DescriptionHTML: ri.DescriptionHTML, Activity: []Activity{}}
	if d.Comments, err = c.comments(ctx, pid, id); err != nil {
		return ItemDetail{}, err
	}
	for _, cm := range d.Comments {
		d.Agent = d.Agent || cm.Agent
	}
	acts, err := list[rawActivity](ctx, c.api, "/projects/"+pid+"/work-items/"+id+"/activities/", nil)
	if err == nil {
		for _, a := range acts {
			if a.Field == "comment" || a.Verb == "" {
				continue
			}
			d.Activity = append(d.Activity, Activity{
				ID: a.ID, Actor: c.member(string(a.Actor), a.ActorDetail), Verb: a.Verb, Field: a.Field,
				OldValue: a.OldValue, NewValue: a.NewValue, CreatedAt: a.CreatedAt,
			})
		}
		sort.SliceStable(d.Activity, func(i, j int) bool { return d.Activity[i].CreatedAt > d.Activity[j].CreatedAt })
	}
	return d, nil
}

func (c *Client) projectFor(ctx context.Context, pid string) (rawProject, *meta, error) {
	m, err := c.projectMeta(ctx, pid, false)
	if err != nil {
		return rawProject{}, nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, p := range c.last.Projects {
		if p.ID == pid {
			return rawProject{ID: p.ID, Name: p.Name, Identifier: p.Identifier}, m, nil
		}
	}
	return rawProject{ID: pid}, m, nil
}

func (c *Client) Update(ctx context.Context, pid, id string, p ItemPatch) error {
	body := map[string]any{}
	if p.Name != nil {
		body["name"] = *p.Name
	}
	if p.StateID != nil {
		body["state"] = *p.StateID
	}
	if p.Priority != nil {
		body["priority"] = *p.Priority
	}
	if p.LabelIDs != nil {
		body["labels"] = *p.LabelIDs
	}
	if p.TargetDate != nil {
		if *p.TargetDate == "" {
			body["target_date"] = nil
		} else {
			body["target_date"] = *p.TargetDate
		}
	}
	return c.api.do(ctx, http.MethodPatch, "/projects/"+pid+"/work-items/"+id+"/", body, nil)
}

func (c *Client) Create(ctx context.Context, n NewItem) (Item, error) {
	body := map[string]any{"name": n.Name}
	if n.StateID != "" {
		body["state"] = n.StateID
	}
	if n.Priority != "" {
		body["priority"] = n.Priority
	}
	if n.DescriptionHTML != "" {
		body["description_html"] = n.DescriptionHTML
	}
	var ri rawItem
	if err := c.api.do(ctx, http.MethodPost, "/projects/"+n.ProjectID+"/work-items/", body, &ri); err != nil {
		return Item{}, err
	}
	rp, m, err := c.projectFor(ctx, n.ProjectID)
	if err != nil {
		return Item{}, err
	}
	return c.toItem(rp, m, ri), nil
}

func (c *Client) Comment(ctx context.Context, pid, id, html string) error {
	c.mu.Lock()
	delete(c.threads, id)
	c.mu.Unlock()
	return c.api.do(ctx, http.MethodPost, "/projects/"+pid+"/work-items/"+id+"/comments/", map[string]any{"comment_html": html}, nil)
}
