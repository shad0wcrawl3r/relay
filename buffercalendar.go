package main

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
)

// The timeline shows an organization's Buffer posts due or sent in a window
// of days. Stepping through weeks would re-read the same lists on every
// click, so each list (upcoming, failed, sent) is kept in memory for a few
// minutes and only extended when a window reaches past what's loaded.
// Nothing here is written to disk.

const (
	// calendarTTL is how long loaded lists are reused before reading again.
	calendarTTL = 3 * time.Minute
	// calendarPages caps the pages one call may add to a list.
	calendarPages = 5
	// calendarMaxPages caps a list overall, however far the user steps.
	calendarMaxPages = 20
)

// CalendarPost is a Buffer post on the timeline.
type CalendarPost struct {
	buffer.Post
	OrganizationID string `json:"organizationId"`
}

// CalendarPosts is the window's posts.
type CalendarPosts struct {
	Posts []CalendarPost `json:"posts"`
	// Partial is set when a list stopped at a page cap, so some days may be
	// missing posts.
	Partial bool `json:"partial"`
	// Limited explains why loaded posts are shown without reading more:
	// Buffer is rate limiting. Empty otherwise.
	Limited string `json:"limited"`
	// LoadedAt is when the oldest list in use was first read.
	LoadedAt time.Time `json:"loadedAt"`
}

// calendarList is one status list as far as it has been read. Upcoming
// lists run oldest due first; the others newest first.
type calendarList struct {
	statuses []string
	upcoming bool
	posts    []buffer.Post
	cursor   string
	more     bool
	pages    int
	loadedAt time.Time
}

type calendarCache struct {
	// mu is held across fetches, so two windows asked for at once share the
	// pages instead of reading them twice.
	mu    sync.Mutex
	lists map[string]*calendarList
}

func (c *calendarCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lists = nil
}

var calendarLists = []struct {
	name     string
	statuses []string
	upcoming bool
}{
	{"upcoming", []string{"scheduled", "needs_approval", "sending"}, true},
	{"error", []string{"error"}, false},
	{"sent", []string{"sent"}, false},
}

// Calendar lists an organization's Buffer posts between from and to:
// scheduled ones (and those awaiting approval or failed) by due time, sent
// ones by when they went out. fresh drops what's loaded and reads again.
func (s *BufferService) Calendar(ctx context.Context, orgID string, from, to time.Time, fresh bool) (CalendarPosts, error) {
	if !to.After(from) {
		return CalendarPosts{}, errors.New("the calendar window is empty")
	}
	if orgID == "" {
		return CalendarPosts{}, errors.New("choose a Buffer organization")
	}
	c := &s.calendar
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.lists == nil {
		c.lists = map[string]*calendarList{}
	}

	out := CalendarPosts{Posts: []CalendarPost{}}
	for _, l := range calendarLists {
		key := orgID + "|" + l.name
		list := c.lists[key]
		if list == nil || fresh || time.Since(list.loadedAt) > calendarTTL {
			list = &calendarList{statuses: l.statuses, upcoming: l.upcoming, more: true, loadedAt: time.Now()}
			c.lists[key] = list
		}
		partial, err := s.extend(ctx, orgID, list, from, to)
		var limited *buffer.RateLimited
		switch {
		case errors.As(err, &limited) && list.pages > 0:
			// Show what's loaded rather than nothing.
			out.Limited = err.Error()
		case err != nil:
			if list.pages == 0 {
				delete(c.lists, key)
			}
			return CalendarPosts{}, err
		}
		out.Partial = out.Partial || partial
		if out.LoadedAt.IsZero() || list.loadedAt.Before(out.LoadedAt) {
			out.LoadedAt = list.loadedAt
		}
		for _, p := range list.posts {
			if at, ok := calendarTime(p); ok && inWindow(at, from, to) {
				out.Posts = append(out.Posts, CalendarPost{Post: p, OrganizationID: orgID})
			}
		}
	}
	return out, nil
}

// extend reads more of list until it covers the window, Buffer has no more,
// or a page cap is hit (partial).
func (s *BufferService) extend(ctx context.Context, orgID string, list *calendarList, from, to time.Time) (partial bool, err error) {
	for added := 0; list.more && !list.covers(from, to); added++ {
		if added == calendarPages || list.pages == calendarMaxPages {
			return true, nil
		}
		page, err := s.client.Posts(ctx, buffer.PostQuery{OrganizationID: orgID, Statuses: list.statuses, After: list.cursor})
		if err != nil {
			return false, err
		}
		list.posts = append(list.posts, page.Posts...)
		list.cursor, list.more = page.Cursor, page.More && page.Cursor != ""
		list.pages++
	}
	return false, nil
}

// covers reports whether the loaded posts reach past the window's far edge:
// to for upcoming lists, from for the rest. A list with no more pages
// covers everything.
func (l *calendarList) covers(from, to time.Time) bool {
	if !l.more {
		return true
	}
	if len(l.posts) == 0 {
		return false
	}
	at, ok := calendarTime(l.posts[len(l.posts)-1])
	if !ok {
		return false
	}
	if l.upcoming {
		return !at.Before(to)
	}
	return at.Before(from)
}

// calendarTime is when a post belongs on the calendar: when it went out if
// it did, otherwise when it's due.
func calendarTime(p buffer.Post) (time.Time, bool) {
	v := p.DueAt
	if p.Status == "sent" && p.SentAt != "" {
		v = p.SentAt
	}
	if v == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, v)
	return t, err == nil
}

func inWindow(t, from, to time.Time) bool { return !t.Before(from) && t.Before(to) }
