package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/devto"
	"github.com/shad0wcrawl3r/relay/internal/posts"
)

// fakeForem is enough of Dev.to's articles API for a post's whole life:
// create a draft, update, publish, unpublish, list. Deleting happens on
// Dev.to's site (the API has no delete), so the test removes articles itself.
type fakeForem struct {
	mu       sync.Mutex
	next     int
	articles map[int]*devto.Article
	// puts records each PUT body, to check what an unpublish sends.
	puts []map[string]any
}

func newFakeForem(t *testing.T) *fakeForem {
	t.Helper()
	f := &fakeForem{next: 100, articles: map[int]*devto.Article{}}
	srv := httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(srv.Close)
	old := devto.SetBaseURL(srv.URL + "/api")
	t.Cleanup(func() { devto.SetBaseURL(old) })
	var key string
	config.Override(func(c *config.Config) { key, c.DevTo.APIKey = c.DevTo.APIKey, "test-key" })
	t.Cleanup(func() { config.Override(func(c *config.Config) { c.DevTo.APIKey = key }) })
	return f
}

func (f *fakeForem) serve(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("api-key") != "test-key" {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	path := strings.TrimPrefix(r.URL.Path, "/api")
	var in struct {
		Article map[string]any `json:"article"`
	}
	if r.Body != nil {
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &in)
	}
	switch {
	case r.Method == http.MethodGet && path == "/articles/me/all":
		out := []devto.Article{}
		for _, a := range f.articles {
			out = append(out, *a)
		}
		_ = json.NewEncoder(w).Encode(out)
	case r.Method == http.MethodPost && path == "/articles":
		f.next++
		a := &devto.Article{ID: f.next, URL: "https://dev.to/me/post-" + strconv.Itoa(f.next), CreatedAt: time.Now().Format(time.RFC3339)}
		apply(a, in.Article)
		f.articles[a.ID] = a
		_ = json.NewEncoder(w).Encode(a)
	case r.Method == http.MethodPut && strings.HasPrefix(path, "/articles/"):
		id, _ := strconv.Atoi(strings.TrimPrefix(path, "/articles/"))
		a, ok := f.articles[id]
		if !ok {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		f.puts = append(f.puts, in.Article)
		apply(a, in.Article)
		_ = json.NewEncoder(w).Encode(a)
	default:
		http.Error(w, `{"error":"unexpected"}`, http.StatusBadRequest)
	}
}

func apply(a *devto.Article, in map[string]any) {
	if v, ok := in["title"].(string); ok {
		a.Title = v
	}
	if v, ok := in["body_markdown"].(string); ok {
		a.BodyMarkdown = v
	}
	if v, ok := in["published"].(bool); ok {
		a.Published = v
		if v {
			a.PublishedAt = time.Now().Format(time.RFC3339)
		}
	}
}

func (f *fakeForem) get(id int) devto.Article {
	f.mu.Lock()
	defer f.mu.Unlock()
	return *f.articles[id]
}

func TestDevtoLifecycle(t *testing.T) {
	f := newFakeForem(t)
	ctx := context.Background()
	s := testService(t)
	p, err := s.store.Save(posts.Post{Meta: posts.Meta{Title: "Lifecycle", AI: AIAssisted}, Body: "Hello.\n"})
	if err != nil {
		t.Fatal(err)
	}

	// Send: an unpublished draft carrying the AI disclosure.
	sent, err := s.Send(ctx, p.ID, false)
	if err != nil || sent.Drift != nil {
		t.Fatalf("send: %v %+v", err, sent.Drift)
	}
	id := sent.Post.DevtoID
	if a := f.get(id); a.Published || !strings.Contains(a.BodyMarkdown, disclosures[AIAssisted]) {
		t.Fatalf("draft on Dev.to: published=%v body=%q", a.Published, a.BodyMarkdown)
	}

	// Publish, then unpublish.
	if _, err := s.Publish(ctx, p.ID); err != nil {
		t.Fatal(err)
	}
	if !f.get(id).Published {
		t.Fatal("publish didn't make it live")
	}
	body := f.get(id).BodyMarkdown
	if _, err := s.Unpublish(ctx, p.ID); err != nil {
		t.Fatal(err)
	}
	if a := f.get(id); a.Published || a.BodyMarkdown != body {
		t.Fatalf("after unpublish: published=%v, body changed=%v", a.Published, a.BodyMarkdown != body)
	}
	last := f.puts[len(f.puts)-1]
	if len(last) != 1 || last["published"] != false {
		t.Errorf("unpublish sent %v; want only published=false, so nothing else on Dev.to changes", last)
	}
	list, _ := s.Sync(ctx)
	for _, row := range list.Posts {
		if row.ID == p.ID && (row.Published || row.Gone) {
			t.Errorf("listed as published=%v gone=%v after unpublish", row.Published, row.Gone)
		}
	}

	// Delete: Relay links to Dev.to's delete page.
	link, err := s.DeleteURL(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if want := "https://dev.to/me/post-" + strconv.Itoa(id) + "/delete_confirm"; link != want {
		t.Errorf("delete link %q, want %q", link, want)
	}

	// Deleted on Dev.to: a later sync marks it gone, and Unlink makes it local again.
	f.mu.Lock()
	delete(f.articles, id)
	f.mu.Unlock()
	cur, _ := s.store.Get(p.ID)
	cur.SentAt = time.Now().Add(-time.Hour)
	cur.Promotions = []posts.Promotion{{BufferID: "old"}}
	if _, err := s.store.Save(cur); err != nil {
		t.Fatal(err)
	}
	list, _ = s.Sync(ctx)
	gone := false
	for _, row := range list.Posts {
		gone = gone || (row.ID == p.ID && row.Gone)
	}
	if !gone {
		t.Fatal("an article deleted on Dev.to wasn't marked gone")
	}
	local, err := s.Unlink(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if local.DevtoID != 0 || local.DevtoURL != "" || local.Body != "Hello.\n" || local.AI != AIAssisted || len(local.Promotions) != 0 {
		t.Errorf("after unlink: %+v", local.Meta)
	}
}

func TestJustSentDraftIsntGone(t *testing.T) {
	f := newFakeForem(t)
	ctx := context.Background()
	s := testService(t)
	p, _ := s.store.Save(posts.Post{Meta: posts.Meta{Title: "Fresh"}, Body: "x"})
	sent, err := s.Send(ctx, p.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	// Dev.to's list can lag a new draft for a moment.
	f.mu.Lock()
	delete(f.articles, sent.Post.DevtoID)
	f.mu.Unlock()
	list, _ := s.Sync(ctx)
	for _, row := range list.Posts {
		if row.ID == p.ID && row.Gone {
			t.Error("a draft sent seconds ago was marked gone")
		}
	}
}

func TestDeleteURLFallsBackToDashboard(t *testing.T) {
	s := testService(t)
	p, _ := s.store.Save(posts.Post{Meta: posts.Meta{Title: "T", DevtoID: 9, DevtoURL: "https://example.com/x/y"}})
	if link, _ := s.DeleteURL(p.ID); link != "https://dev.to/dashboard" {
		t.Errorf("link %q for a URL that isn't Dev.to's", link)
	}
	unsent, _ := s.store.Save(posts.Post{Meta: posts.Meta{Title: "U"}})
	if _, err := s.DeleteURL(unsent.ID); err == nil {
		t.Error("a local-only post has no Dev.to delete page")
	}
}

func TestPendingPromotions(t *testing.T) {
	rows := []PromotionPost{
		{Promotion: posts.Promotion{BufferID: "a"}, Found: true, Status: "scheduled"},
		{Promotion: posts.Promotion{BufferID: "b"}, Found: true, Status: "sent"},
		{Promotion: posts.Promotion{BufferID: "c"}, Found: false},
		{Promotion: posts.Promotion{BufferID: "d"}, Found: true, Status: "needs_approval"},
	}
	ids, err := pendingPromotions(rows)
	if err != nil || strings.Join(ids, ",") != "a,d" {
		t.Errorf("ids %v, err %v; want a,d", ids, err)
	}
	rows = append(rows, PromotionPost{Promotion: posts.Promotion{BufferID: "e"}, LookupError: "rate limited"})
	if ids, err := pendingPromotions(rows); err == nil || len(ids) != 0 {
		t.Errorf("with a failed lookup: ids %v, err %v; want none and an error", ids, err)
	}
}
