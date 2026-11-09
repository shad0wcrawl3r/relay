package buffer

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestContentItemsReadsDraftsAndPosts(t *testing.T) {
	c, got := captureVars(t, `{"data":{"contentItems":{"edges":[
		{"node":{"id":"c1","title":null,"targetDate":"2026-11-12T12:00:00Z","createdAt":"2026-11-01T00:00:00Z","allowedActions":["deleteContentItem"],
			"tags":[{"id":"t1","name":"Relay: Ready","color":"#3b82f6","isLocked":false}],
			"body":{"__typename":"DraftContent","text":"hello","aiAssisted":false,"assets":[{"id":"a1"}]}}},
		{"node":{"id":"c2","title":"Launch","targetDate":null,"createdAt":"2026-11-02T00:00:00Z","allowedActions":[],"tags":[],
			"body":{"__typename":"PostContent","posts":[{"id":"p1","status":"sent","text":"x","dueAt":null}]}}}],
		"pageInfo":{"hasNextPage":false,"endCursor":null}}}}`)
	items, err := c.ContentItems(context.Background(), "o1")
	if err != nil {
		t.Fatal(err)
	}
	if vars := jsonOf(got.Variables); !strings.Contains(vars, `"organizationId":"o1"`) || !strings.Contains(vars, `"field":"targetDate"`) {
		t.Errorf("variables = %s", vars)
	}
	if len(items) != 2 {
		t.Fatalf("items = %+v", items)
	}
	a, b := items[0], items[1]
	if a.Draft == nil || a.Draft.Text != "hello" || !a.Draft.HasAssets || !a.CanDelete || a.Posts != nil || a.TargetDate == "" {
		t.Errorf("draft item = %+v", a)
	}
	if b.Draft != nil || len(b.Posts) != 1 || b.Title != "Launch" || b.CanDelete {
		t.Errorf("posts item = %+v", b)
	}
}

func TestCreateContentItemUsesTitleAsText(t *testing.T) {
	c, got := captureVars(t, `{"data":{"createContentItemDraft":{"contentItem":{"id":"c9","title":"Ship it","createdAt":"x","allowedActions":[],"tags":[],
		"body":{"__typename":"DraftContent","text":"Ship it","aiAssisted":false,"assets":[]}}}}}`)
	it, err := c.CreateContentItem(context.Background(), NewContentItem{OrganizationID: "o1", Title: " Ship it ", TagIDs: []string{"t1"}, TargetDate: "2026-11-12"})
	if err != nil {
		t.Fatal(err)
	}
	vars := jsonOf(got.Variables)
	for _, want := range []string{`"text":"Ship it"`, `"title":"Ship it"`, `"tagIds":["t1"]`, `"targetDate":"2026-11-12T12:00:00Z"`, `"assets":[]`} {
		if !strings.Contains(vars, want) {
			t.Errorf("variables %s missing %s", vars, want)
		}
	}
	if it.ID != "c9" || it.Draft == nil {
		t.Errorf("item = %+v", it)
	}
	c, _ = captureVars(t, `{"data":{"createContentItemDraft":{"message":"text too long"}}}`)
	if _, err := c.CreateContentItem(context.Background(), NewContentItem{OrganizationID: "o1", Title: "x"}); err == nil || !strings.Contains(err.Error(), "text too long") {
		t.Errorf("err = %v", err)
	}
}

func TestSetContentItemTagsResendsTheDraft(t *testing.T) {
	c, got := captureVars(t, `{"data":{"updateContentItemDraft":{"contentItem":{"id":"c1"}}}}`)
	it := ContentItem{ID: "c1", Draft: &ItemDraft{Text: "keep me", AIAssisted: true}}
	if err := c.SetContentItemTags(context.Background(), it, nil); err != nil {
		t.Fatal(err)
	}
	vars := jsonOf(got.Variables)
	for _, want := range []string{`"text":"keep me"`, `"aiAssisted":true`, `"tagIds":[]`} {
		if !strings.Contains(vars, want) {
			t.Errorf("variables %s missing %s", vars, want)
		}
	}
	if err := c.SetContentItemTags(context.Background(), ContentItem{ID: "c2"}, nil); !errors.Is(err, ErrNotDraft) {
		t.Errorf("posts item: err = %v", err)
	}
	if err := c.SetContentItemTags(context.Background(), ContentItem{ID: "c3", Draft: &ItemDraft{HasAssets: true}}, nil); !errors.Is(err, ErrHasAssets) {
		t.Errorf("assets: err = %v", err)
	}
}

func TestEditContentItemClearsTheDate(t *testing.T) {
	c, got := captureVars(t, `{"data":{"updateContentItem":{"contentItem":{"id":"c1"}}}}`)
	empty := ""
	if err := c.EditContentItem(context.Background(), ContentItemEdit{ID: "c1", TargetDate: &empty}); err != nil {
		t.Fatal(err)
	}
	if vars := jsonOf(got.Variables); !strings.Contains(vars, `"targetDate":null`) || strings.Contains(vars, `"title"`) {
		t.Errorf("variables = %s", vars)
	}
}
