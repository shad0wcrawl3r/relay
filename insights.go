package main

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
)

// Insights: how an article and its promotions did. Each integration that
// can report engagement feeds this (CLAUDE.md): Dev.to from the article list
// Relay already syncs (no extra call), Buffer from post metrics, which cover
// every channel it posts to, LinkedIn included. Buffer refreshes metrics once
// a day, so its answer is cached for an hour and fetched only when the user
// opens a post's insights.

// Insights is one post's numbers.
type Insights struct {
	Devto      *DevtoInsights     `json:"devto"`
	Promotions []PromotionInsight `json:"promotions"`
	// Buffer is how the Buffer part went: "ok", "none" (no promotions),
	// "needs-key" (Buffer withholds metrics from OAuth sign-ins), "bad-key",
	// "not-connected" or "error".
	Buffer      string    `json:"buffer"`
	BufferError string    `json:"bufferError"`
	FetchedAt   time.Time `json:"fetchedAt"`
}

type DevtoInsights struct {
	Published bool   `json:"published"`
	Views     int    `json:"views"`
	Reactions int    `json:"reactions"`
	Comments  int    `json:"comments"`
	URL       string `json:"url"`
}

type PromotionInsight struct {
	BufferID string          `json:"bufferId"`
	Channel  string          `json:"channel"`
	Service  string          `json:"service"`
	At       time.Time       `json:"at"`
	Metrics  []buffer.Metric `json:"metrics"`
	// UpdatedAt is when Buffer last refreshed the metrics; nil until it has.
	UpdatedAt *time.Time `json:"updatedAt"`
	// Found is false once Buffer no longer has the post.
	Found bool `json:"found"`
}

const insightsTTL = time.Hour

var insightsLog = logs.For("buffer")

type insightsCache struct {
	mu   sync.Mutex
	byID map[string]map[string]buffer.PostMetrics
	at   map[string]time.Time
}

// Insights returns a post's numbers. refresh skips the cache.
func (s *BufferService) Insights(ctx context.Context, postID string, refresh bool) (Insights, error) {
	p, err := s.posts.store.Get(postID)
	if err != nil {
		return Insights{}, err
	}
	out := Insights{Buffer: "none", Promotions: []PromotionInsight{}, FetchedAt: time.Now()}

	if p.DevtoID != 0 {
		s.posts.mu.Lock()
		a, ok := s.posts.remote[p.DevtoID]
		s.posts.mu.Unlock()
		if ok {
			out.Devto = &DevtoInsights{Published: a.Published, Views: a.PageViewsCount, Reactions: a.PublicReactionsCount, Comments: a.CommentsCount, URL: a.URL}
		}
	}

	if len(p.Promotions) == 0 {
		return out, nil
	}
	if !s.client.Connected() {
		out.Buffer = "not-connected"
		return out, nil
	}
	ids := make([]string, 0, len(p.Promotions))
	for _, pr := range p.Promotions {
		if pr.BufferID != "" {
			ids = append(ids, pr.BufferID)
		}
	}
	metrics, err := s.metrics(ctx, postID, ids, refresh)
	switch {
	case errors.Is(err, buffer.ErrNoInsights):
		out.Buffer = "needs-key"
	case errors.Is(err, buffer.ErrBadKey):
		out.Buffer = "bad-key"
	case err != nil:
		out.Buffer, out.BufferError = "error", err.Error()
	default:
		out.Buffer = "ok"
	}
	for _, pr := range p.Promotions {
		row := PromotionInsight{BufferID: pr.BufferID, Channel: pr.Channel, Service: pr.Service, At: pr.At}
		if m, ok := metrics[pr.BufferID]; ok {
			row.Metrics, row.UpdatedAt, row.Found = m.Metrics, m.UpdatedAt, m.Found
		}
		if row.Metrics == nil {
			row.Metrics = []buffer.Metric{}
		}
		out.Promotions = append(out.Promotions, row)
	}
	return out, nil
}

func (s *BufferService) metrics(ctx context.Context, postID string, ids []string, refresh bool) (map[string]buffer.PostMetrics, error) {
	c := &s.insights
	c.mu.Lock()
	if !refresh && time.Since(c.at[postID]) < insightsTTL {
		m := c.byID[postID]
		c.mu.Unlock()
		return m, nil
	}
	c.mu.Unlock()

	m, err := s.client.PostMetrics(ctx, strings.TrimSpace(config.GetConfig().Buffer.InsightsKey), ids)
	if err != nil {
		insightsLog.Info("insights unavailable", "post", postID, "reason", insightsReason(err))
		return nil, err
	}
	c.mu.Lock()
	if c.byID == nil {
		c.byID, c.at = map[string]map[string]buffer.PostMetrics{}, map[string]time.Time{}
	}
	c.byID[postID], c.at[postID] = m, time.Now()
	c.mu.Unlock()
	return m, nil
}

// dropInsights forgets cached metrics, after the key changes or sign-out.
func (s *BufferService) dropInsights() {
	s.insights.mu.Lock()
	s.insights.byID, s.insights.at = nil, nil
	s.insights.mu.Unlock()
}

func insightsReason(err error) string {
	switch {
	case errors.Is(err, buffer.ErrNoInsights):
		return "needs a personal key"
	case errors.Is(err, buffer.ErrBadKey):
		return "key refused"
	}
	return "error"
}
