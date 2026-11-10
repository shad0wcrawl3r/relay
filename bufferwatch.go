package main

import (
	"context"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Buffer posts can fail after they leave Relay: an expired channel token, a
// network rejecting the text. Buffer says so only in its own app, so Relay
// checks for failed posts at launch and every so often, and tells the user
// about ones it hasn't mentioned since launch.

var bufferWatchLog = logs.For("buffer")

const (
	failedFirstCheck = 20 * time.Second
	failedEvery      = 15 * time.Minute
)

// FailedPost is one post Buffer couldn't publish. Text stays out: the alert
// only needs where and why.
type FailedPost struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organizationId"`
	ChannelID      string `json:"channelId"`
	ChannelService string `json:"channelService"`
	DueAt          string `json:"dueAt"`
	Error          string `json:"error"`
	ErrorHelp      string `json:"errorHelp"`
}

// FailedPosts is what a check found: every failed post, and the ones that
// are new since the last alert.
type FailedPosts struct {
	All []FailedPost `json:"all"`
	New []FailedPost `json:"new"`
}

type failedWatch struct {
	mu   sync.Mutex
	seen map[string]bool
	last []FailedPost
}

func (s *BufferService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	go func() {
		wait := failedFirstCheck
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
			wait = failedEvery
			if !s.client.Connected() {
				continue
			}
			found, err := s.CheckFailed(ctx)
			if err != nil {
				bufferWatchLog.Debug("failed-post check skipped", "err", err)
				continue
			}
			if len(found.New) > 0 {
				application.Get().Event.Emit("buffer:failed", found)
			}
		}
	}()
	return nil
}

// CheckFailed looks for failed posts in every organization. New lists the
// ones not reported since launch; calling it marks them reported.
func (s *BufferService) CheckFailed(ctx context.Context) (FailedPosts, error) {
	a, err := s.client.Account(ctx)
	if err != nil {
		return FailedPosts{}, err
	}
	all := []FailedPost{}
	for _, org := range a.Organizations {
		page, err := s.client.Posts(ctx, buffer.PostQuery{OrganizationID: org.ID, Statuses: []string{"error"}})
		if err != nil {
			return FailedPosts{}, err
		}
		for _, p := range page.Posts {
			all = append(all, FailedPost{
				ID: p.ID, OrganizationID: org.ID, ChannelID: p.ChannelID, ChannelService: p.ChannelService,
				DueAt: p.DueAt, Error: p.Error, ErrorHelp: p.ErrorHelp,
			})
		}
	}
	return s.failed.record(all), nil
}

// LastFailed is the last check's failed posts, without asking Buffer.
func (s *BufferService) LastFailed() []FailedPost {
	s.failed.mu.Lock()
	defer s.failed.mu.Unlock()
	return append([]FailedPost{}, s.failed.last...)
}

func (w *failedWatch) record(all []FailedPost) FailedPosts {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.seen == nil {
		w.seen = map[string]bool{}
	}
	out := FailedPosts{All: all, New: []FailedPost{}}
	for _, p := range all {
		if !w.seen[p.ID] {
			w.seen[p.ID] = true
			out.New = append(out.New, p)
		}
	}
	w.last = all
	if len(out.New) > 0 {
		bufferWatchLog.Info("failed posts found", "total", len(all), "new", len(out.New))
	}
	return out
}

// reset forgets what was reported, on sign-out.
func (w *failedWatch) reset() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.seen, w.last = nil, nil
}
