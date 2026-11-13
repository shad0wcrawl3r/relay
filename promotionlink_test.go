package main

import (
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
)

func TestMentionsArticle(t *testing.T) {
	const u = "https://dev.to/me/enhanced-ai-support-for-relay-3k2j"
	for text, want := range map[string]bool{
		"New post: https://dev.to/me/enhanced-ai-support-for-relay-3k2j": true,
		"read it at dev.to/me/enhanced-ai-support-for-relay-3k2j/":       true,
		"https://DEV.to/ashwin/Enhanced-AI-Support-for-Relay-3k2j?utm=li":    true,
		"shortened: https://buff.ly/abc123":                                  false,
		"https://dev.to/me/another-post-9zz1":                            false,
	} {
		if got := mentionsArticle(text, u); got != want {
			t.Errorf("mentionsArticle(%q) = %v, want %v", text, got, want)
		}
	}
	if mentionsArticle("dev.to/x/about", "https://dev.to/x/about") != true {
		t.Error("full link should match even with a short slug")
	}
	if mentionsArticle("see about this", "https://dev.to/x/about") {
		t.Error("a short slug alone shouldn't match")
	}
}

func TestLinkCandidates(t *testing.T) {
	const u = "https://dev.to/me/linking-buffer-posts-ab12"
	found := []buffer.Post{
		{ID: "old", Text: "unrelated", Status: "sent", SentAt: "2026-11-01T10:00:00Z", ChannelID: "li"},
		{ID: "mine", Text: "Read " + u, Status: "sent", SentAt: "2026-10-01T10:00:00Z", ChannelID: "li"},
		{ID: "new", Text: "also unrelated", Status: "scheduled", DueAt: "2026-11-20T10:00:00Z", ChannelID: "li"},
		{ID: "taken", Text: u, Status: "sent", SentAt: "2026-11-02T10:00:00Z"},
		{ID: "mine", Text: "duplicate", Status: "sent"},
	}
	channels := []buffer.Channel{{ID: "li", Name: "me", DisplayName: "My page", Service: "linkedin"}}
	linked := map[string]PromotedArticle{"taken": {PostID: "other"}}
	got := linkCandidates(found, channels, linked, u)
	var ids []string
	for _, c := range got {
		ids = append(ids, c.BufferID)
	}
	if want := []string{"mine", "new", "old"}; len(ids) != 3 || ids[0] != want[0] || ids[1] != want[1] || ids[2] != want[2] {
		t.Fatalf("order = %v, want %v", ids, want)
	}
	if !got[0].Mentions || got[1].Mentions || got[0].Channel != "My page" || got[0].Service != "linkedin" {
		t.Errorf("first candidate = %+v", got[0])
	}
}
