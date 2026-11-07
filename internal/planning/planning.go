// Package planning shows Buffer content items as a board project, so Relay
// can plan without Plane. Experimental, like the Buffer API it's built on. Columns before posting are Buffer tags that Relay
// creates ("Relay: To do", …); untagged items are ideas, and items that
// already hold channel posts are Scheduled or Published, from their posts.
package planning

import (
	"html"
	"slices"
	"strings"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
	"github.com/shad0wcrawl3r/relay/internal/plane"
)

const (
	// ProjectID is the board project's ID; never a Plane UUID.
	ProjectID = "buffer-plan"
	// Identifier prefixes card keys and keys the project in Settings.
	Identifier = "BUF"
	// TagPrefix marks the tags Relay uses as columns.
	TagPrefix = "Relay: "
)

// Column is a board column. Tag is the Buffer tag that puts a draft in it;
// columns without one are derived (Idea: no column tag; Scheduled and
// Published: the item holds posts).
type Column struct {
	ID    string
	Name  string
	Group string
	Color string
	Tag   string
}

var (
	Idea      = Column{ID: "buffer:idea", Name: "Idea", Group: "backlog", Color: "#a855f7"}
	Todo      = Column{ID: "buffer:todo", Name: "Todo", Group: "unstarted", Color: "#60646c", Tag: TagPrefix + "To do"}
	Doing     = Column{ID: "buffer:doing", Name: "In Progress", Group: "started", Color: "#f59e0b", Tag: TagPrefix + "In progress"}
	Ready     = Column{ID: "buffer:ready", Name: "Ready", Group: "started", Color: "#3b82f6", Tag: TagPrefix + "Ready"}
	Scheduled = Column{ID: "buffer:scheduled", Name: "Scheduled", Group: "started", Color: "#14b8a6"}
	Published = Column{ID: "buffer:published", Name: "Published", Group: "completed", Color: "#46a758"}

	Columns = []Column{Idea, Todo, Doing, Ready, Scheduled, Published}
)

// ColumnByID finds a column; ok is false for an unknown ID.
func ColumnByID(id string) (Column, bool) {
	i := slices.IndexFunc(Columns, func(c Column) bool { return c.ID == id })
	if i < 0 {
		return Column{}, false
	}
	return Columns[i], true
}

// Movable reports whether cards can be dragged into or out of c. Scheduled
// and Published follow from the item's posts, which Buffer manages.
func (c Column) Movable() bool { return c != Scheduled && c != Published }

// IsColumnTag is true for tags Relay uses as columns, which aren't shown as labels.
func IsColumnTag(t buffer.OrgTag) bool { return strings.HasPrefix(t.Name, TagPrefix) }

// ColumnOf places a content item on the board.
func ColumnOf(it buffer.ContentItem) Column {
	if it.Draft == nil {
		if len(it.Posts) > 0 && !slices.ContainsFunc(it.Posts, func(p buffer.ItemPost) bool { return p.Status != "sent" }) {
			return Published
		}
		return Scheduled
	}
	// The last column tag set wins, if someone added two in Buffer.
	for i := len(it.Tags) - 1; i >= 0; i-- {
		for _, c := range Columns {
			if c.Tag != "" && it.Tags[i].Name == c.Tag {
				return c
			}
		}
	}
	return Idea
}

// Project builds the board project from an organization's content items and tags.
func Project(name string, items []buffer.ContentItem, tags []buffer.OrgTag) plane.Project {
	p := plane.Project{
		ID: ProjectID, Identifier: Identifier, Name: name, Source: "buffer",
		Labels: []plane.Label{}, Modules: []plane.Module{}, Cycles: []plane.Cycle{}, Items: []plane.Item{},
	}
	for i, c := range Columns {
		p.States = append(p.States, plane.State{ID: c.ID, Name: c.Name, Color: c.Color, Group: c.Group, Default: i == 0})
	}
	for _, t := range tags {
		if !IsColumnTag(t) {
			p.Labels = append(p.Labels, plane.Label{ID: t.ID, Name: t.Name, Color: t.Color})
		}
	}
	for _, it := range items {
		p.Items = append(p.Items, Item(it))
	}
	return p
}

// Item turns a content item into a card.
func Item(it buffer.ContentItem) plane.Item {
	return plane.Item{
		ID: it.ID, ProjectID: ProjectID, Key: Key(it.ID), Name: Name(it),
		StateID: ColumnOf(it).ID, Priority: "none",
		LabelIDs: LabelTags(it), ModuleIDs: []string{}, CycleIDs: []string{},
		TargetDate: day(it.TargetDate), CreatedAt: it.CreatedAt, UpdatedAt: it.CreatedAt,
	}
}

// Key is a short, stable card key from the content item ID.
func Key(id string) string {
	short := id
	if len(short) > 6 {
		short = short[len(short)-6:]
	}
	return Identifier + "-" + strings.ToUpper(short)
}

// Name is the title, or the first line of the content.
func Name(it buffer.ContentItem) string {
	if t := strings.TrimSpace(it.Title); t != "" {
		return t
	}
	text := ""
	if it.Draft != nil {
		text = it.Draft.Text
	} else if len(it.Posts) > 0 {
		text = it.Posts[0].Text
	}
	line, _, _ := strings.Cut(strings.TrimSpace(text), "\n")
	if r := []rune(line); len(r) > 80 {
		line = string(r[:79]) + "…"
	}
	if line == "" {
		return "Untitled"
	}
	return line
}

// Description is the card's content as HTML: the draft, or each post.
func Description(it buffer.ContentItem) string {
	if it.Draft != nil {
		return paragraphs(it.Draft.Text)
	}
	var b strings.Builder
	for _, p := range it.Posts {
		b.WriteString("<p><strong>" + html.EscapeString(p.Status) + "</strong></p>")
		b.WriteString(paragraphs(p.Text))
	}
	return b.String()
}

func paragraphs(text string) string {
	var b strings.Builder
	for _, para := range strings.Split(strings.TrimSpace(text), "\n\n") {
		if para = strings.TrimSpace(para); para != "" {
			b.WriteString("<p>" + strings.ReplaceAll(html.EscapeString(para), "\n", "<br>") + "</p>")
		}
	}
	return b.String()
}

// LabelTags are the item's tag IDs that aren't column tags.
func LabelTags(it buffer.ContentItem) []string { return tagIDs(it, false) }

// ColumnTags are the item's column tag IDs: normally one, or none for an idea.
func ColumnTags(it buffer.ContentItem) []string { return tagIDs(it, true) }

func tagIDs(it buffer.ContentItem, column bool) []string {
	out := []string{}
	for _, t := range it.Tags {
		if IsColumnTag(t) == column {
			out = append(out, t.ID)
		}
	}
	return out
}

func day(dt string) string {
	if len(dt) >= 10 {
		return dt[:10]
	}
	return dt
}
