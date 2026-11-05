package main

import (
	"context"
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/devto"
	"github.com/shad0wcrawl3r/relay/internal/posts"
)

// No Dev.to key in tests, so Sync leaves the seeded remote copies alone.
func driftService(t *testing.T, local posts.Post, remote devto.Article) (*PostService, posts.Post) {
	t.Helper()
	s := testService(t)
	p, err := s.store.Save(local)
	if err != nil {
		t.Fatal(err)
	}
	s.remote[remote.ID] = remote
	return s, p
}

func TestDriftIgnoresLocalOnlyEdits(t *testing.T) {
	sent := fingerprint("T", "hello")
	s, p := driftService(t,
		posts.Post{Meta: posts.Meta{Title: "T", DevtoID: 7, DevtoHash: sent}, Body: "hello, edited in Relay"},
		devto.Article{ID: 7, Title: "T", BodyMarkdown: "hello"})
	if d, err := s.drift(context.Background(), p); err != nil || d != nil {
		t.Fatalf("local edits only: drift = %+v, %v", d, err)
	}
}

func TestDriftCatchesEditsOnDevto(t *testing.T) {
	s, p := driftService(t,
		posts.Post{Meta: posts.Meta{Title: "T", DevtoID: 7, DevtoHash: fingerprint("T", "hello <INSERT IMAGE HERE: x>")}, Body: "hello <INSERT IMAGE HERE: x>"},
		devto.Article{ID: 7, Title: "T", BodyMarkdown: "hello ![x](https://img)", EditedAt: "2026-11-05T10:00:00Z"})
	d, err := s.drift(context.Background(), p)
	if err != nil || d == nil {
		t.Fatalf("edit on Dev.to missed: %+v, %v", d, err)
	}
	if !d.Known || d.RemoteBody != "hello ![x](https://img)" || d.LocalBody != "hello <INSERT IMAGE HERE: x>" {
		t.Errorf("drift = %+v", d)
	}
	if res, err := s.Send(context.Background(), p.ID, false); err != nil || res.Drift == nil {
		t.Errorf("Send overwrote a drifted article: %+v, %v", res, err)
	}
}

func TestDriftWithoutAFingerprint(t *testing.T) {
	s, p := driftService(t,
		posts.Post{Meta: posts.Meta{Title: "T", DevtoID: 7}, Body: "a"},
		devto.Article{ID: 7, Title: "T", BodyMarkdown: "b"})
	d, _ := s.drift(context.Background(), p)
	if d == nil || d.Known {
		t.Errorf("legacy post that differs: drift = %+v", d)
	}
	s.remote[7] = devto.Article{ID: 7, Title: "T", BodyMarkdown: "a\r\n  "}
	if d, _ := s.drift(context.Background(), p); d != nil {
		t.Errorf("whitespace and line endings counted as drift: %+v", d)
	}
}

func TestPullDevtoTakesDevtosCopy(t *testing.T) {
	s, p := driftService(t,
		posts.Post{Meta: posts.Meta{Title: "Old", DevtoID: 7, Promotions: []posts.Promotion{{BufferID: "b1"}}}, Body: "old"},
		devto.Article{ID: 7, Title: "New", BodyMarkdown: "new"})
	got, err := s.PullDevto(context.Background(), p.ID)
	if err != nil || got.Title != "New" || got.Body != "new" || got.DevtoHash != fingerprint("New", "new") || len(got.Promotions) != 1 {
		t.Fatalf("pulled = %+v, %v", got.Meta, err)
	}
	// The editor's autosave of an older copy keeps Go's fingerprint.
	stale := got
	stale.DevtoHash = ""
	saved, err := s.Save(stale)
	if err != nil || saved.DevtoHash != got.DevtoHash {
		t.Errorf("autosave dropped the fingerprint: %q", saved.DevtoHash)
	}
	if d, _ := s.drift(context.Background(), saved); d != nil {
		t.Errorf("drift right after a pull: %+v", d)
	}
}
