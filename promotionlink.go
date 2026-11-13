package main

import (
	"context"
	"errors"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
	"github.com/shad0wcrawl3r/relay/internal/posts"
)

// Linking a Buffer post to an article: a post about the article that wasn't
// sent with Promote (written in Buffer, in the composer, or from Ship)
// becomes one of its promotions, so its insights show with the article's.
// Relay reads only the recent posts, when the user asks, and Go re-reads the
// chosen one from Buffer before recording it.

// LinkCandidate is a recent Buffer post that could be linked.
type LinkCandidate struct {
	BufferID  string `json:"bufferId"`
	Text      string `json:"text"`
	Channel   string `json:"channel"`
	ChannelID string `json:"channelId"`
	Service   string `json:"service"`
	Status    string `json:"status"`
	SentAt    string `json:"sentAt"`
	DueAt     string `json:"dueAt"`
	// Mentions is true when the text has the article's link or slug.
	Mentions bool `json:"mentions"`
}

// linkPages bounds how many pages of posts each organization is read for.
const linkPages = 2

// linkStatuses are the posts worth linking: gone out, or about to.
var linkStatuses = []string{"sent", "scheduled", "sending"}

// LinkCandidates lists recent Buffer posts not linked to any article yet,
// those that mention this one first.
func (s *BufferService) LinkCandidates(ctx context.Context, postID string) ([]LinkCandidate, error) {
	articleURL, err := s.posts.PublishedURL(postID)
	if err != nil {
		return nil, err
	}
	account, err := s.client.Account(ctx)
	if err != nil {
		return nil, err
	}
	channels, err := s.client.ChannelsIn(ctx, account.Organizations)
	if err != nil {
		return nil, err
	}
	linked, err := s.PromotionIndex()
	if err != nil {
		return nil, err
	}
	var found []buffer.Post
	for _, org := range account.Organizations {
		q := buffer.PostQuery{OrganizationID: org.ID, Statuses: linkStatuses}
		for range linkPages {
			page, err := s.client.Posts(ctx, q)
			if err != nil {
				return nil, err
			}
			found = append(found, page.Posts...)
			if !page.More || page.Cursor == "" {
				break
			}
			q.After = page.Cursor
		}
	}
	return linkCandidates(found, channels, linked, articleURL), nil
}

func linkCandidates(found []buffer.Post, channels []buffer.Channel, linked map[string]PromotedArticle, articleURL string) []LinkCandidate {
	names := map[string]buffer.Channel{}
	for _, ch := range channels {
		names[ch.ID] = ch
	}
	out := []LinkCandidate{}
	seen := map[string]bool{}
	for _, p := range found {
		if p.ID == "" || seen[p.ID] {
			continue
		}
		seen[p.ID] = true
		if _, ok := linked[p.ID]; ok {
			continue
		}
		ch := names[p.ChannelID]
		service := p.ChannelService
		if service == "" {
			service = ch.Service
		}
		out = append(out, LinkCandidate{
			BufferID: p.ID, Text: preview(p.Text), Channel: channelName(ch), ChannelID: p.ChannelID, Service: service,
			Status: p.Status, SentAt: p.SentAt, DueAt: p.DueAt, Mentions: mentionsArticle(p.Text, articleURL),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Mentions != out[j].Mentions {
			return out[i].Mentions
		}
		return when(out[i]) > when(out[j])
	})
	return out
}

func when(c LinkCandidate) string {
	if c.SentAt != "" {
		return c.SentAt
	}
	return c.DueAt
}

func channelName(ch buffer.Channel) string {
	if ch.DisplayName != "" {
		return ch.DisplayName
	}
	return ch.Name
}

// preview shortens a post's text for the list.
func preview(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	if r := []rune(text); len(r) > 240 {
		return string(r[:240]) + "…"
	}
	return text
}

// mentionsArticle reports whether text has the article's link, with or
// without the scheme, or its slug (a shortened link still leaves no slug, so
// those posts are listed too, just not first).
func mentionsArticle(text, articleURL string) bool {
	text = strings.ToLower(text)
	u, err := url.Parse(strings.ToLower(strings.TrimSpace(articleURL)))
	if err != nil || u.Host == "" {
		return false
	}
	path := strings.Trim(u.Path, "/")
	if strings.Contains(text, u.Host+"/"+path) {
		return true
	}
	slug := path[strings.LastIndexByte(path, '/')+1:]
	// Short slugs ("about") would match too much.
	return len(slug) >= 12 && strings.Contains(text, slug)
}

// LinkPromotion records a Buffer post as one of the article's promotions.
// The post is read from Buffer again, rather than trusting the UI.
func (s *BufferService) LinkPromotion(ctx context.Context, postID, bufferID string) (posts.Post, error) {
	if _, err := s.posts.PublishedURL(postID); err != nil {
		return posts.Post{}, err
	}
	bufferID = strings.TrimSpace(bufferID)
	linked, err := s.PromotionIndex()
	if err != nil {
		return posts.Post{}, err
	}
	if a, ok := linked[bufferID]; ok {
		if a.PostID == postID {
			return posts.Post{}, errors.New("that Buffer post is already linked to this article")
		}
		return posts.Post{}, errors.New("that Buffer post is already linked to another article")
	}
	bp, found, err := s.client.Post(ctx, bufferID)
	if err != nil {
		return posts.Post{}, err
	}
	if !found {
		return posts.Post{}, errors.New("Buffer no longer has that post")
	}
	channel := ""
	if channels, err := s.client.Channels(ctx); err == nil {
		for _, ch := range channels {
			if ch.ID == bp.ChannelID {
				channel = channelName(ch)
			}
		}
	}
	promo := posts.Promotion{BufferID: bp.ID, Channel: channel, ChannelID: bp.ChannelID, Service: bp.ChannelService, Timing: "linked", At: time.Now()}
	if t, err := time.Parse(time.RFC3339, bp.DueAt); err == nil {
		promo.DueAt = t
	}
	p, err := s.posts.RecordPromotion(postID, promo)
	if err != nil {
		return posts.Post{}, err
	}
	s.dropInsights()
	insightsLog.Info("linked a Buffer post to an article", "post", postID)
	return p, nil
}
