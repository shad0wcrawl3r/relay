package planning

import (
	"slices"
	"strings"
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
)

var (
	doingTag = buffer.OrgTag{ID: "t-doing", Name: Doing.Tag}
	launch   = buffer.OrgTag{ID: "t-launch", Name: "Launch"}
)

func TestColumnOf(t *testing.T) {
	draft := &buffer.ItemDraft{Text: "x"}
	cases := []struct {
		name string
		it   buffer.ContentItem
		want Column
	}{
		{"untagged draft is an idea", buffer.ContentItem{Draft: draft, Tags: []buffer.OrgTag{launch}}, Idea},
		{"column tag", buffer.ContentItem{Draft: draft, Tags: []buffer.OrgTag{launch, doingTag}}, Doing},
		{"posts still to go", buffer.ContentItem{Posts: []buffer.ItemPost{{Status: "sent"}, {Status: "scheduled"}}, Tags: []buffer.OrgTag{doingTag}}, Scheduled},
		{"every post sent", buffer.ContentItem{Posts: []buffer.ItemPost{{Status: "sent"}}}, Published},
		{"no posts yet", buffer.ContentItem{Posts: []buffer.ItemPost{}}, Scheduled},
	}
	for _, c := range cases {
		if got := ColumnOf(c.it); got != c.want {
			t.Errorf("%s: got %s, want %s", c.name, got.Name, c.want.Name)
		}
	}
}

func TestProjectHidesColumnTags(t *testing.T) {
	it := buffer.ContentItem{ID: "abcdef123456", Draft: &buffer.ItemDraft{Text: "First line\nmore"}, Tags: []buffer.OrgTag{launch, doingTag}, TargetDate: "2026-11-12T12:00:00Z"}
	p := Project("Acme plan", []buffer.ContentItem{it}, []buffer.OrgTag{launch, doingTag})
	if len(p.Labels) != 1 || p.Labels[0].ID != "t-launch" {
		t.Errorf("labels = %+v", p.Labels)
	}
	if len(p.States) != len(Columns) || !p.States[0].Default || p.States[0].Name != "Idea" {
		t.Errorf("states = %+v", p.States)
	}
	got := p.Items[0]
	if got.Key != "BUF-123456" || got.Name != "First line" || got.StateID != Doing.ID || got.TargetDate != "2026-11-12" || !slices.Equal(got.LabelIDs, []string{"t-launch"}) {
		t.Errorf("item = %+v", got)
	}
}

func TestTagSplit(t *testing.T) {
	it := buffer.ContentItem{Tags: []buffer.OrgTag{launch, doingTag}}
	if !slices.Equal(LabelTags(it), []string{"t-launch"}) || !slices.Equal(ColumnTags(it), []string{"t-doing"}) {
		t.Errorf("labels %v columns %v", LabelTags(it), ColumnTags(it))
	}
}

func TestDescriptionEscapes(t *testing.T) {
	d := Description(buffer.ContentItem{Draft: &buffer.ItemDraft{Text: "<b>hi</b>\nthere\n\nnext"}})
	if strings.Contains(d, "<b>") || d != "<p>&lt;b&gt;hi&lt;/b&gt;<br>there</p><p>next</p>" {
		t.Errorf("description = %q", d)
	}
}

func TestMovable(t *testing.T) {
	for _, c := range Columns {
		want := c != Scheduled && c != Published
		if c.Movable() != want {
			t.Errorf("%s movable = %v", c.Name, c.Movable())
		}
	}
}
