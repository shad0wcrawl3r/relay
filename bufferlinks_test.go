package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
)

func TestIdeaPostTitle(t *testing.T) {
	for _, c := range []struct{ title, text, wantTitle, wantBody string }{
		{"Ship log", "notes here", "Ship log", "notes here\n"},
		{"", "# First line\nthe rest", "First line", "the rest\n"},
		{"", "only a line", "only a line", ""},
		{"", "", "Untitled post", ""},
	} {
		title, body := ideaPost(c.title, c.text)
		if title != c.wantTitle || body != c.wantBody {
			t.Errorf("ideaPost(%q, %q) = %q, %q; want %q, %q", c.title, c.text, title, body, c.wantTitle, c.wantBody)
		}
	}
	// A long first line is cut for the title and kept in the body.
	long := strings.Repeat("word ", 40)
	title, body := ideaPost("", long)
	if !strings.HasSuffix(title, "…") || len([]rune(title)) > 81 || body == "" {
		t.Errorf("long line: title %q, body %q", title, body)
	}
}

func TestFailedWatchReportsEachPostOnce(t *testing.T) {
	var w failedWatch
	got := w.record([]FailedPost{{ID: "a"}, {ID: "b"}})
	if len(got.New) != 2 || len(got.All) != 2 {
		t.Fatalf("first check: %+v", got)
	}
	got = w.record([]FailedPost{{ID: "b"}, {ID: "c"}})
	if len(got.New) != 1 || got.New[0].ID != "c" || len(got.All) != 2 {
		t.Fatalf("second check: %+v", got)
	}
	w.reset()
	if got = w.record([]FailedPost{{ID: "b"}}); len(got.New) != 1 {
		t.Fatalf("after sign-out: %+v", got)
	}
}

func TestCalendarTime(t *testing.T) {
	sent := buffer.Post{Status: "sent", DueAt: "2026-11-10T09:00:00Z", SentAt: "2026-11-10T09:02:00Z"}
	if at, ok := calendarTime(sent); !ok || at.Minute() != 2 {
		t.Errorf("sent post dated %v, %v; want its send time", at, ok)
	}
	due := buffer.Post{Status: "scheduled", DueAt: "2026-11-12T15:00:00.000Z"}
	if at, ok := calendarTime(due); !ok || at.Day() != 12 {
		t.Errorf("scheduled post dated %v, %v", at, ok)
	}
	if _, ok := calendarTime(buffer.Post{Status: "draft"}); ok {
		t.Error("undated draft placed on the calendar")
	}
	from := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	if !inWindow(from, from, from.Add(time.Hour)) || inWindow(from.Add(time.Hour), from, from.Add(time.Hour)) {
		t.Error("window should include its start and exclude its end")
	}
}

func TestCalendarServesLoadedListsWithoutAskingBuffer(t *testing.T) {
	// No client: any request to Buffer would panic.
	s := &BufferService{}
	now := time.Now()
	post := func(id, status string, at time.Time) buffer.Post {
		return buffer.Post{ID: id, Status: status, DueAt: at.UTC().Format(time.RFC3339)}
	}
	s.calendar.lists = map[string]*calendarList{
		"org|upcoming": {posts: []buffer.Post{post("a", "scheduled", now.Add(time.Hour)), post("b", "scheduled", now.Add(30*24*time.Hour))}, loadedAt: now, pages: 1},
		"org|error":    {loadedAt: now, pages: 1},
		"org|sent":     {posts: []buffer.Post{post("c", "sent", now.Add(-time.Hour))}, loadedAt: now, pages: 1},
	}
	from, to := now.Add(-24*time.Hour), now.Add(24*time.Hour)
	for range 3 {
		got, err := s.Calendar(context.Background(), "org", from, to, false)
		if err != nil {
			t.Fatal(err)
		}
		if len(got.Posts) != 2 {
			t.Fatalf("got %d posts, want a and c", len(got.Posts))
		}
	}
}

func TestCalendarListCoverage(t *testing.T) {
	now := time.Now()
	at := func(d time.Duration) buffer.Post {
		return buffer.Post{Status: "scheduled", DueAt: now.Add(d).UTC().Format(time.RFC3339)}
	}
	from, to := now, now.Add(7*24*time.Hour)

	up := &calendarList{upcoming: true, more: true, posts: []buffer.Post{at(time.Hour)}}
	if up.covers(from, to) {
		t.Error("upcoming list ending inside the window shouldn't cover it")
	}
	up.posts = append(up.posts, at(8*24*time.Hour))
	if !up.covers(from, to) {
		t.Error("upcoming list reaching past the window should cover it")
	}
	past := &calendarList{more: true, posts: []buffer.Post{at(2 * time.Hour)}}
	if past.covers(from, to) {
		t.Error("sent list not yet back to the window's start shouldn't cover it")
	}
	if !(&calendarList{more: false}).covers(from, to) {
		t.Error("a fully read list covers every window")
	}
}
