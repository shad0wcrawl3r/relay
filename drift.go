package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/shad0wcrawl3r/relay/internal/devto"
	"github.com/shad0wcrawl3r/relay/internal/posts"
)

// Relay and Dev.to can both edit a post: images are usually swapped in on
// Dev.to. Each send or pull records a fingerprint of Dev.to's copy; if the
// live copy no longer matches, it was edited there, and Relay shows the
// difference instead of overwriting it.

// Drift is Dev.to's copy of a post next to Relay's, when they disagree.
type Drift struct {
	RemoteTitle string `json:"remoteTitle"`
	RemoteBody  string `json:"remoteBody"`
	LocalTitle  string `json:"localTitle"`
	LocalBody   string `json:"localBody"`
	EditedAt    string `json:"editedAt"`
	// Known is false for posts sent before Relay kept fingerprints: then it
	// can't tell which side changed, only that they differ.
	Known bool `json:"known"`
}

func fingerprint(title, body string) string {
	sum := sha256.Sum256([]byte(normalise(title) + "\x00" + normalise(body)))
	return hex.EncodeToString(sum[:])
}

// normalise ignores line endings and trailing whitespace, which Dev.to may
// change without anyone editing.
func normalise(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " \t")
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

// remoteChanged says whether Dev.to's copy moved on from the last send or
// pull. known is false when there's no fingerprint to compare with.
func remoteChanged(p posts.Post, a devto.Article) (changed, known bool) {
	if p.DevtoHash == "" {
		return false, false
	}
	return fingerprint(a.Title, a.BodyMarkdown) != p.DevtoHash, true
}

// drift fetches Dev.to's copy and reports it if it was edited there. Nothing
// to report when the copies match or Dev.to's is unchanged since last time.
func (s *PostService) drift(ctx context.Context, p posts.Post) (*Drift, error) {
	s.Sync(ctx)
	s.mu.Lock()
	a, ok := s.remote[p.DevtoID]
	syncErr := s.syncErr
	s.mu.Unlock()
	if !ok {
		if syncErr != "" {
			return nil, errors.New("couldn't check Dev.to's copy before updating: " + syncErr)
		}
		// Gone from Dev.to: the update will say so.
		return nil, nil
	}
	// Compare what Relay would send with Dev.to's copy, minus any disclosure
	// line Relay added in the past.
	local := p.Body
	remote, _ := splitDisclosure(a.BodyMarkdown)
	same := fingerprint(a.Title, remote) == fingerprint(p.Title, local)
	changed, known := remoteChanged(p, a)
	if same || (known && !changed) {
		return nil, nil
	}
	return &Drift{
		RemoteTitle: a.Title, RemoteBody: a.BodyMarkdown,
		LocalTitle: p.Title, LocalBody: local,
		EditedAt: a.EditedAt, Known: known,
	}, nil
}

// Drift reports how Dev.to's copy differs from Relay's, or nil if it doesn't.
func (s *PostService) Drift(ctx context.Context, id string) (*Drift, error) {
	p, err := s.store.Get(id)
	if err != nil || p.DevtoID == 0 {
		return nil, err
	}
	return s.drift(ctx, p)
}

// PullDevto replaces Relay's title and body with Dev.to's copy.
func (s *PostService) PullDevto(ctx context.Context, id string) (posts.Post, error) {
	p, err := s.store.Get(id)
	if err != nil {
		return posts.Post{}, err
	}
	if p.DevtoID == 0 {
		return posts.Post{}, errors.New("this post isn't on Dev.to yet")
	}
	s.Sync(ctx)
	s.mu.Lock()
	a, ok := s.remote[p.DevtoID]
	s.mu.Unlock()
	if !ok {
		return posts.Post{}, errors.New("couldn't load Dev.to's copy; sync and try again")
	}
	p.Title = a.Title
	// Dev.to's AI marker (or an old disclosure line) becomes the setting;
	// when Dev.to doesn't say, the post keeps its own.
	body, level := remoteBody(a.BodyMarkdown, a.AIDisclosureLevel)
	p.Body = body
	if level != "" {
		p.AI = level
	}
	p.DevtoHash = fingerprint(a.Title, a.BodyMarkdown)
	devtoLog.Notice("pulled from Dev.to", "id", id, "devto_id", p.DevtoID)
	return s.store.Save(p)
}
