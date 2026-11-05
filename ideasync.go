package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/shad0wcrawl3r/relay/internal/plane"
	"github.com/shad0wcrawl3r/relay/internal/vault"
)

// Plane boards show Buffer's ideas in a "Buffer" column. Buffer's API can
// create and list ideas but not edit or delete them, so the sync is: new
// ideas go to Buffer, a work item dropped on the column becomes an idea, and
// an idea dropped on a state becomes a work item. Links between the two are
// kept so neither side gets duplicates.
//
// Private (lockable) projects take no part, in either direction: their items
// must not reach Buffer, and their keys must not land in the link file.

var ideaLog = logs.For("ideas")

// IdeaLink ties a Buffer idea to the work item made from it, or made into it.
type IdeaLink struct {
	IdeaID    string    `json:"ideaId"`
	ProjectID string    `json:"projectId"`
	ItemID    string    `json:"itemId"`
	Key       string    `json:"key"`
	At        time.Time `json:"at"`
}

type ideaLinks struct {
	mu     sync.Mutex
	path   string
	loaded bool
	byIdea map[string]IdeaLink
}

func newIdeaLinks(path string) *ideaLinks {
	return &ideaLinks{path: path, byIdea: map[string]IdeaLink{}}
}

func (l *ideaLinks) load() {
	if l.loaded {
		return
	}
	l.loaded = true
	b, err := vault.ReadFile(l.path)
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err != nil {
		ideaLog.Warn("could not read idea links", "error", err)
		return
	}
	var list []IdeaLink
	if err := json.Unmarshal(b, &list); err != nil {
		ideaLog.Warn("could not read idea links", "error", err)
		return
	}
	for _, link := range list {
		l.byIdea[link.IdeaID] = link
	}
}

func (l *ideaLinks) all() map[string]IdeaLink {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.load()
	out := make(map[string]IdeaLink, len(l.byIdea))
	for k, v := range l.byIdea {
		out[k] = v
	}
	return out
}

func (l *ideaLinks) forIdea(id string) (IdeaLink, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.load()
	link, ok := l.byIdea[id]
	return link, ok
}

func (l *ideaLinks) forItem(itemID string) (IdeaLink, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.load()
	for _, link := range l.byIdea {
		if link.ItemID == itemID {
			return link, true
		}
	}
	return IdeaLink{}, false
}

func (l *ideaLinks) add(link IdeaLink) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.load()
	l.byIdea[link.IdeaID] = link
	list := make([]IdeaLink, 0, len(l.byIdea))
	for _, v := range l.byIdea {
		list = append(list, v)
	}
	b, err := json.Marshal(list)
	if err != nil {
		return err
	}
	return vault.WriteFile(l.path, b)
}

func ideaLinksPath() string { return filepath.Join(config.AppDir(), "buffer-idea-links.json") }

// ErrPrivate refuses Buffer sync for lockable projects and modules.
var ErrPrivate = errors.New("private projects don't sync with Buffer")

// shareable finds a project and, when itemID is set, its item, refusing
// anything lockable, whether it's unlocked right now or not.
func (s *PlaneService) shareable(projectID, itemID string) (plane.Project, plane.Item, error) {
	snap := s.client.Last()
	for _, p := range snap.Projects {
		if p.ID != projectID {
			continue
		}
		if plane.Lockable(plane.ProjectKey(p.Identifier)) {
			return p, plane.Item{}, ErrPrivate
		}
		if itemID == "" {
			return p, plane.Item{}, nil
		}
		for _, it := range p.Items {
			if it.ID != itemID {
				continue
			}
			for _, m := range it.ModuleIDs {
				if plane.Lockable(plane.ModuleKey(m)) {
					return p, it, ErrPrivate
				}
			}
			return p, it, nil
		}
		return p, plane.Item{}, errors.New("work item not found; sync Plane and try again")
	}
	return plane.Project{}, plane.Item{}, errors.New("project not found; sync Plane and try again")
}

// IdeaLinks lists which ideas are tied to work items, keyed by idea ID.
func (s *BufferService) IdeaLinks() map[string]IdeaLink {
	return s.links.all()
}

// ItemToIdea saves a work item as a Buffer idea: its name as the title and
// its description as the text.
func (s *BufferService) ItemToIdea(ctx context.Context, orgID, projectID, itemID string) (buffer.Idea, error) {
	if s.plane == nil {
		return buffer.Idea{}, errors.New("Plane isn't available")
	}
	if _, it, err := s.plane.shareable(projectID, itemID); err != nil {
		return buffer.Idea{}, err
	} else if link, ok := s.links.forItem(it.ID); ok {
		return buffer.Idea{}, fmt.Errorf("%s is already a Buffer idea", link.Key)
	}
	d, err := s.plane.Detail(ctx, projectID, itemID)
	if err != nil {
		return buffer.Idea{}, err
	}
	idea, err := s.client.CreateIdea(ctx, buffer.NewIdea{OrganizationID: orgID, Title: d.Name, Text: htmlToText(d.DescriptionHTML)})
	if err != nil {
		return buffer.Idea{}, err
	}
	if err := s.links.add(IdeaLink{IdeaID: idea.ID, ProjectID: projectID, ItemID: itemID, Key: d.Key, At: time.Now()}); err != nil {
		ideaLog.Error("could not save the idea link", "error", err)
	}
	ideaLog.Notice("work item saved as idea", "idea", idea.ID, "item", itemID)
	return idea, nil
}

// IdeaToItemInput is an idea dropped on a board column. Buffer has no
// single-idea query, so the frontend passes the content it already shows.
type IdeaToItemInput struct {
	IdeaID    string `json:"ideaId"`
	Title     string `json:"title"`
	Text      string `json:"text"`
	ProjectID string `json:"projectId"`
	StateID   string `json:"stateId"`
}

// IdeaToItem makes a work item from a Buffer idea, once.
func (s *BufferService) IdeaToItem(ctx context.Context, in IdeaToItemInput) (plane.Item, error) {
	if s.plane == nil {
		return plane.Item{}, errors.New("Plane isn't available")
	}
	if in.IdeaID == "" {
		return plane.Item{}, errors.New("no idea to add")
	}
	if link, ok := s.links.forIdea(in.IdeaID); ok {
		return plane.Item{}, fmt.Errorf("this idea is already %s", link.Key)
	}
	if _, _, err := s.plane.shareable(in.ProjectID, ""); err != nil {
		return plane.Item{}, err
	}
	name, desc := ideaToItem(in.Title, in.Text)
	it, err := s.plane.Create(ctx, plane.NewItem{ProjectID: in.ProjectID, Name: name, StateID: in.StateID, DescriptionHTML: desc})
	if err != nil {
		return plane.Item{}, err
	}
	if err := s.links.add(IdeaLink{IdeaID: in.IdeaID, ProjectID: in.ProjectID, ItemID: it.ID, Key: it.Key, At: time.Now()}); err != nil {
		ideaLog.Error("could not save the idea link", "error", err)
	}
	ideaLog.Notice("idea added to Plane", "idea", in.IdeaID, "item", it.ID)
	return it, nil
}

const maxItemName = 120

// ideaToItem names the work item after the idea's title, or its first line,
// and keeps the full text as the description.
func ideaToItem(title, text string) (name, descHTML string) {
	title, text = strings.TrimSpace(title), strings.TrimSpace(text)
	name = title
	if name == "" {
		name, _, _ = strings.Cut(text, "\n")
	}
	if r := []rune(strings.TrimSpace(name)); len(r) > maxItemName {
		name = string(r[:maxItemName-1]) + "…"
	}
	if name == "" {
		name = "Buffer idea"
	}
	var b strings.Builder
	for _, para := range strings.Split(text, "\n\n") {
		if para = strings.TrimSpace(para); para != "" {
			b.WriteString("<p>" + strings.ReplaceAll(html.EscapeString(para), "\n", "<br>") + "</p>")
		}
	}
	b.WriteString("<p><em>From a Buffer idea.</em></p>")
	return strings.TrimSpace(name), b.String()
}

var (
	blockEnd = regexp.MustCompile(`(?i)</(p|div|li|h[1-6]|blockquote|pre)>|<br\s*/?>`)
	anyTag   = regexp.MustCompile(`<[^>]*>`)
	blankRun = regexp.MustCompile(`\n{3,}`)
)

// htmlToText turns Plane's description HTML into plain text for Buffer.
func htmlToText(s string) string {
	s = blockEnd.ReplaceAllString(s, "\n\n")
	s = anyTag.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " \t")
	}
	return strings.TrimSpace(blankRun.ReplaceAllString(strings.Join(lines, "\n"), "\n\n"))
}
