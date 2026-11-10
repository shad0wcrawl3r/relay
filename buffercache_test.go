package main

import (
	"path/filepath"
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
	"github.com/zalando/go-keyring"
)

func TestBufferCacheRoundTrip(t *testing.T) {
	keyring.MockInit()
	path := filepath.Join(t.TempDir(), "buffer-cache.json")
	q := buffer.PostQuery{OrganizationID: "o1", Statuses: []string{"scheduled", "sending"}}

	c := newBufferCache(path)
	c.setOverview(BufferOverview{Account: "Ash"})
	c.setPosts(q, buffer.PostPage{Posts: []buffer.Post{{ID: "p1", Text: "one"}, {ID: "p2", Text: "two"}}})
	c.setIdeas("o1", buffer.IdeaPage{Ideas: []buffer.Idea{{ID: "i1"}}})
	c.removePost("p1")
	c.replacePost(buffer.Post{ID: "p2", Text: "edited"})

	// A fresh cache reads the encrypted file back.
	d := newBufferCache(path)
	if o := d.overview(); o == nil || o.Account != "Ash" {
		t.Fatalf("overview = %+v", o)
	}
	page := d.posts(buffer.PostQuery{OrganizationID: "o1", Statuses: []string{"scheduled", "sending"}, After: "ignored"})
	if page == nil || len(page.Posts) != 1 || page.Posts[0].Text != "edited" {
		t.Fatalf("posts = %+v", page)
	}
	if d.posts(buffer.PostQuery{OrganizationID: "o1", Statuses: []string{"sent"}}) != nil {
		t.Error("another tab's list should miss")
	}
	if i := d.ideas("o1"); i == nil || len(i.Ideas) != 1 {
		t.Errorf("ideas = %+v", i)
	}

	d.clear()
	if e := newBufferCache(path); e.overview() != nil || e.posts(q) != nil {
		t.Error("clear should remove the file")
	}
}
