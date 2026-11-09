package main

import (
	"context"
	"errors"
	"slices"
	"sync"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/shad0wcrawl3r/relay/internal/plane"
	"github.com/shad0wcrawl3r/relay/internal/planning"
)

var planLog = logs.For("buffer")

// bufferPlan keeps the last load of the Buffer planning board. Card text
// stays in memory: it is never written to disk or logged.
type bufferPlan struct {
	client *buffer.Client

	mu     sync.Mutex
	org    buffer.Organization
	items  []buffer.ContentItem
	tags   []buffer.OrgTag
	err    string
	loaded bool
}

func newBufferPlan(c *buffer.Client) *bufferPlan { return &bufferPlan{client: c} }

// on is true when the board is turned on and Buffer is signed in.
func (b *bufferPlan) on() bool {
	return b != nil && b.client != nil && config.GetConfig().Planning.Buffer && b.client.Connected()
}

// refresh reloads the organization's content items and tags.
func (b *bufferPlan) refresh(ctx context.Context) {
	if b == nil {
		return
	}
	if !b.on() {
		b.mu.Lock()
		b.items, b.tags, b.err, b.loaded = nil, nil, "", false
		b.mu.Unlock()
		return
	}
	org, err := b.organization(ctx)
	var items []buffer.ContentItem
	var tags []buffer.OrgTag
	if err == nil {
		items, err = b.client.ContentItems(ctx, org.ID)
	}
	if err == nil {
		tags, err = b.client.Tags(ctx, org.ID)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if err != nil {
		planLog.Warn("planning board load failed", "error", err)
		b.err = err.Error()
		return
	}
	b.org, b.items, b.tags, b.err, b.loaded = org, items, tags, "", true
}

func (b *bufferPlan) organization(ctx context.Context) (buffer.Organization, error) {
	a, err := b.client.Account(ctx)
	if err != nil {
		return buffer.Organization{}, err
	}
	want := config.GetConfig().Planning.BufferOrg
	for _, o := range a.Organizations {
		if want == "" || o.ID == want {
			return o, nil
		}
	}
	return buffer.Organization{}, errors.New("the Buffer organization chosen for planning isn't on this account any more; pick another in Settings → Publishing")
}

// apply adds the board to snap when it's on.
func (b *bufferPlan) apply(snap plane.Snapshot) plane.Snapshot {
	if !b.on() {
		return snap
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	snap.BufferPlan = true
	snap.BufferPlanError = b.err
	if !b.loaded {
		return snap
	}
	name := "Buffer plan"
	if b.org.Name != "" {
		name = b.org.Name + " plan"
	}
	snap.Projects = append(slices.Clone(snap.Projects), planning.Project(name, b.items, b.tags))
	return snap
}

func (b *bufferPlan) find(id string) (buffer.ContentItem, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	i := slices.IndexFunc(b.items, func(it buffer.ContentItem) bool { return it.ID == id })
	if i < 0 {
		return buffer.ContentItem{}, errors.New("that card isn't on the Buffer board any more; sync and try again")
	}
	return b.items[i], nil
}

func (b *bufferPlan) detail(id string) (plane.ItemDetail, error) {
	if !b.on() {
		return plane.ItemDetail{}, errors.New("planning in Buffer is off")
	}
	it, err := b.find(id)
	if err != nil {
		return plane.ItemDetail{}, err
	}
	return plane.ItemDetail{Item: planning.Item(it), DescriptionHTML: planning.Description(it), Comments: []plane.Comment{}, Activity: []plane.Activity{}}, nil
}

// columnTag returns the Buffer tag for column c, creating it on first use.
func (b *bufferPlan) columnTag(ctx context.Context, c planning.Column) (string, error) {
	if c.Tag == "" {
		return "", nil
	}
	b.mu.Lock()
	org := b.org.ID
	for _, t := range b.tags {
		if t.Name == c.Tag {
			b.mu.Unlock()
			return t.ID, nil
		}
	}
	b.mu.Unlock()
	t, err := b.client.CreateTag(ctx, org, c.Tag, c.Color)
	if err != nil {
		return "", err
	}
	b.mu.Lock()
	b.tags = append(b.tags, t)
	b.mu.Unlock()
	return t.ID, nil
}

func (b *bufferPlan) update(ctx context.Context, id string, patch plane.ItemPatch) error {
	it, err := b.find(id)
	if err != nil {
		return err
	}
	if patch.Priority != nil && *patch.Priority != "none" {
		return errors.New("Buffer cards don't have priorities")
	}
	if patch.Name != nil || patch.TargetDate != nil {
		if err := b.client.EditContentItem(ctx, buffer.ContentItemEdit{ID: id, Title: patch.Name, TargetDate: patch.TargetDate}); err != nil {
			return err
		}
	}
	if patch.StateID == nil && patch.LabelIDs == nil {
		return nil
	}
	// The tags to keep: labels (new ones if given), then the column tag (the
	// new column's if moving).
	labels := planning.LabelTags(it)
	if patch.LabelIDs != nil {
		labels = slices.Clone(*patch.LabelIDs)
	}
	column := planning.ColumnTags(it)
	if patch.StateID != nil && *patch.StateID != planning.ColumnOf(it).ID {
		to, ok := planning.ColumnByID(*patch.StateID)
		if !ok {
			return errors.New("not a Buffer board column")
		}
		if !to.Movable() || !planning.ColumnOf(it).Movable() {
			return errors.New("Scheduled and Published follow the card's posts in Buffer: schedule or publish it there")
		}
		tag, err := b.columnTag(ctx, to)
		if err != nil {
			return err
		}
		column = nil
		if tag != "" {
			column = []string{tag}
		}
	}
	return b.client.SetContentItemTags(ctx, it, append(labels, column...))
}

func (b *bufferPlan) create(ctx context.Context, n plane.NewItem) (plane.Item, error) {
	col := planning.Idea
	if n.StateID != "" {
		c, ok := planning.ColumnByID(n.StateID)
		if !ok || !c.Movable() {
			return plane.Item{}, errors.New("new Buffer cards start in Idea, Todo, In Progress or Ready")
		}
		col = c
	}
	tag, err := b.columnTag(ctx, col)
	if err != nil {
		return plane.Item{}, err
	}
	b.mu.Lock()
	org := b.org.ID
	b.mu.Unlock()
	var tags []string
	if tag != "" {
		tags = []string{tag}
	}
	it, err := b.client.CreateContentItem(ctx, buffer.NewContentItem{
		OrganizationID: org, Title: n.Name, Text: htmlToText(n.DescriptionHTML), TagIDs: tags,
	})
	if err != nil {
		return plane.Item{}, err
	}
	b.mu.Lock()
	b.items = append(b.items, it)
	b.mu.Unlock()
	return planning.Item(it), nil
}
