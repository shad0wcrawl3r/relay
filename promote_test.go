package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/devto"
	"github.com/shad0wcrawl3r/relay/internal/posts"
)

func testService(t *testing.T) *PostService {
	t.Helper()
	store, err := posts.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return &PostService{store: store, remote: map[int]devto.Article{}}
}

func TestPreviewMatchesWhatPromoteSends(t *testing.T) {
	s := testService(t)
	p, _ := s.store.Save(posts.Post{Meta: posts.Meta{Title: "T", DevtoID: 7}})
	b := &BufferService{posts: s}
	if _, err := b.PreviewPromotion(p.ID, "hello"); err == nil {
		t.Error("previewed an unpublished post")
	}
	s.remote[7] = devto.Article{ID: 7, Published: true, URL: "https://dev.to/a/live"}
	got, err := b.PreviewPromotion(p.ID, " hello ")
	if err != nil || got != withLink("hello", "https://dev.to/a/live") {
		t.Errorf("got %q, %v", got, err)
	}
}

func TestWithLinkAddsItOnce(t *testing.T) {
	const url = "https://dev.to/a/post"
	if got := withLink(" hello \n", url); got != "hello\n\n"+url {
		t.Errorf("got %q", got)
	}
	if got := withLink("read "+url+" now", url); strings.Count(got, url) != 1 {
		t.Errorf("got %q", got)
	}
}

func TestPublishedURLNeedsALiveArticle(t *testing.T) {
	s := testService(t)
	p, err := s.store.Save(posts.Post{Meta: posts.Meta{Title: "T", DevtoID: 7, DevtoURL: "https://dev.to/a/draft"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.PublishedURL(p.ID); err == nil {
		t.Error("an unsynced post has no public link")
	}
	s.remote[7] = devto.Article{ID: 7, URL: "https://dev.to/a/temp-slug?preview=abc"}
	if _, err := s.PublishedURL(p.ID); err == nil {
		t.Error("a draft's preview link must never be promoted")
	}
	s.remote[7] = devto.Article{ID: 7, Published: true, URL: "https://dev.to/a/live"}
	if got, err := s.PublishedURL(p.ID); err != nil || got != "https://dev.to/a/live" {
		t.Errorf("got %q, %v", got, err)
	}
}

func TestPublishRefusesUnsentPosts(t *testing.T) {
	s := testService(t)
	unsent, _ := s.store.Save(posts.Post{Meta: posts.Meta{Title: "T"}})
	if _, err := s.Publish(context.Background(), unsent.ID); err == nil || !strings.Contains(err.Error(), "send") {
		t.Errorf("err = %v", err)
	}
}

func TestArticleBodyPrefersDevto(t *testing.T) {
	s := testService(t)
	p := posts.Post{Meta: posts.Meta{Title: "T", DevtoID: 7}, Body: "a <INSERT IMAGE HERE: chart> b"}
	if got := s.articleBody(p); got != p.Body {
		t.Errorf("got %q", got)
	}
	s.remote[7] = devto.Article{ID: 7, BodyMarkdown: "a ![chart](https://img) b"}
	if got := s.articleBody(p); strings.Contains(got, imagePlaceholder) {
		t.Errorf("an image swapped in on Dev.to should clear the placeholder: %q", got)
	}
}

func TestSaveKeepsPromotionsFromAStaleCopy(t *testing.T) {
	s := testService(t)
	p, _ := s.store.Save(posts.Post{Meta: posts.Meta{Title: "T"}})
	stale := p
	if _, err := s.RecordPromotion(p.ID, posts.Promotion{BufferID: "b1", Channel: "Me", Timing: "queue", At: time.Now()}); err != nil {
		t.Fatal(err)
	}
	stale.Title = "Edited"
	saved, err := s.Save(stale)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Title != "Edited" || len(saved.Promotions) != 1 {
		t.Errorf("saved = %+v", saved.Meta)
	}
	reloaded, _ := s.store.Get(p.ID)
	if len(reloaded.Promotions) != 1 || reloaded.Promotions[0].BufferID != "b1" {
		t.Errorf("reloaded = %+v", reloaded.Promotions)
	}
}

func TestSeriesCombinesLocalAndRemote(t *testing.T) {
	s := testService(t)
	_, _ = s.store.Save(posts.Post{Meta: posts.Meta{Title: "A", Series: "Go Notes"}})
	_, _ = s.store.Save(posts.Post{Meta: posts.Meta{Title: "B", Series: "Go Notes"}})
	remote, empty := "Wails", ""
	s.remote[1] = devto.Article{ID: 1, Series: &remote}
	s.remote[2] = devto.Article{ID: 2, Series: &empty}
	got, err := s.Series()
	if err != nil || strings.Join(got, ",") != "Go Notes,Wails" {
		t.Errorf("got %v, %v", got, err)
	}
}

func TestPromotionURLFindsRelayPromotionsOnly(t *testing.T) {
	s := testService(t)
	_, _ = s.store.Save(posts.Post{Meta: posts.Meta{
		Title: "T", DevtoID: 7, DevtoURL: "https://dev.to/a/saved",
		Promotions: []posts.Promotion{{BufferID: "b1", Channel: "LinkedIn", At: time.Now()}},
	}})
	if got := s.PromotionURL("other"); got != "" {
		t.Errorf("unrelated Buffer post got %q", got)
	}
	if got := s.PromotionURL(""); got != "" {
		t.Errorf("empty ID got %q", got)
	}
	// Before a Dev.to sync, fall back to the saved link.
	if got := s.PromotionURL("b1"); got != "https://dev.to/a/saved" {
		t.Errorf("unsynced got %q", got)
	}
	s.remote[7] = devto.Article{ID: 7, Published: true, URL: "https://dev.to/a/live"}
	if got := s.PromotionURL("b1"); got != "https://dev.to/a/live" {
		t.Errorf("synced got %q", got)
	}
}
