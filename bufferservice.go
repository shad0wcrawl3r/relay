package main

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
	"github.com/shad0wcrawl3r/relay/internal/posts"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// BufferService exposes the Buffer sign-in and posting to the frontend. Tokens
// stay in Go.
type BufferService struct {
	client *buffer.Client
	posts  *PostService
	plane  *PlaneService
	links  *ideaLinks
	cache  *bufferCache
}

func NewBufferService(posts *PostService, plane *PlaneService) *BufferService {
	s := &BufferService{client: buffer.New(), posts: posts, plane: plane, links: newIdeaLinks(ideaLinksPath()), cache: newBufferCache(bufferCachePath())}
	// Buffer can end the sign-in on its side (revoked, refresh refused).
	s.client.OnSignOut = func() {
		s.cache.clear()
		integrationsChanged(s)
		go s.plane.reloadBufferPlan(context.Background())
	}
	return s
}

type BufferStatus struct {
	Connected bool   `json:"connected"`
	Account   string `json:"account"`
}

// Status looks up the account when signed in. A failed lookup still reports
// connected: being offline isn't the same as being signed out.
func (s *BufferService) Status(ctx context.Context) BufferStatus {
	if !s.client.Connected() {
		return BufferStatus{}
	}
	a, err := s.client.Account(ctx)
	if errors.Is(err, buffer.ErrNotConnected) {
		return BufferStatus{}
	}
	st := BufferStatus{Connected: true, Account: a.Name}
	if st.Account == "" {
		st.Account = a.Email
	}
	return st
}

func (s *BufferService) Connect(ctx context.Context) (BufferStatus, error) {
	err := s.client.Connect(ctx, func(u string) {
		app := application.Get()
		// Also to the frontend, so the user can copy the link into another
		// browser or profile than the default one.
		app.Event.Emit("buffer:signin", u)
		_ = app.Browser.OpenURL(u)
	})
	if err != nil {
		return BufferStatus{}, err
	}
	integrationsChanged(s)
	s.plane.reloadBufferPlan(ctx)
	return s.Status(ctx), nil
}

func (s *BufferService) Disconnect() error {
	err := s.client.Disconnect()
	s.cache.clear()
	integrationsChanged(s)
	s.plane.reloadBufferPlan(context.Background())
	return err
}

func (s *BufferService) Channels(ctx context.Context) ([]buffer.Channel, error) {
	return s.client.Channels(ctx)
}

// Promotion asks Buffer to post about a published article.
type Promotion struct {
	PostID    string        `json:"postId"`
	ChannelID string        `json:"channelId"`
	Channel   string        `json:"channel"`
	Service   string        `json:"service"`
	Text      string        `json:"text"`
	Timing    buffer.Timing `json:"timing"`
	DueAt     time.Time     `json:"dueAt"`
}

// withLink puts the article's link in the text, once.
func withLink(text, url string) string {
	text = strings.TrimSpace(text)
	if strings.Contains(text, url) {
		return text
	}
	return text + "\n\n" + url
}

// PreviewPromotion returns the exact text Promote would send.
func (s *BufferService) PreviewPromotion(postID, text string) (string, error) {
	url, err := s.posts.PublishedURL(postID)
	if err != nil {
		return "", err
	}
	return promotionText(text, url), nil
}

// Promote sends a post about a published article to Buffer. The link comes from
// Dev.to here, not the frontend, so a promotion can't go out without it.
func (s *BufferService) Promote(ctx context.Context, in Promotion) (posts.Post, error) {
	url, err := s.posts.PublishedURL(in.PostID)
	if err != nil {
		return posts.Post{}, err
	}
	if strings.TrimSpace(in.Text) == "" {
		return posts.Post{}, errors.New("the post is empty")
	}
	bufferID, err := s.client.CreatePost(ctx, buffer.NewPost{
		ChannelID: in.ChannelID, Text: promotionText(in.Text, url), Timing: in.Timing, DueAt: in.DueAt,
	})
	if err != nil {
		return posts.Post{}, err
	}
	return s.posts.RecordPromotion(in.PostID, posts.Promotion{
		BufferID: bufferID, Channel: in.Channel, ChannelID: in.ChannelID, Service: in.Service, Timing: string(in.Timing), DueAt: in.DueAt, At: time.Now(),
	})
}

// Composed is a post written in Relay's Buffer view, not about an article:
// the same text to each channel.
type Composed struct {
	ChannelIDs []string      `json:"channelIds"`
	Text       string        `json:"text"`
	Timing     buffer.Timing `json:"timing"`
	DueAt      time.Time     `json:"dueAt"`
}

// ComposeResult is how one channel's post went: PostID when Buffer took
// it, Error when it didn't.
type ComposeResult struct {
	ChannelID string `json:"channelId"`
	PostID    string `json:"postId"`
	Error     string `json:"error"`
}

// ComposedText is exactly what Compose sends: the text, and the note in dev
// builds.
func (s *BufferService) ComposedText(text string) string {
	return withEvalNote(strings.TrimSpace(text))
}

// Compose sends a post to each channel. One channel refusing doesn't stop
// the rest; the results say which went through.
func (s *BufferService) Compose(ctx context.Context, in Composed) ([]ComposeResult, error) {
	if strings.TrimSpace(in.Text) == "" {
		return nil, errors.New("the post is empty")
	}
	if len(in.ChannelIDs) == 0 {
		return nil, errors.New("choose a channel")
	}
	text := s.ComposedText(in.Text)
	seen := map[string]bool{}
	var results []ComposeResult
	for _, id := range in.ChannelIDs {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		r := ComposeResult{ChannelID: id}
		postID, err := s.client.CreatePost(ctx, buffer.NewPost{ChannelID: id, Text: text, Timing: in.Timing, DueAt: in.DueAt})
		if err != nil {
			r.Error = err.Error()
		} else {
			r.PostID = postID
		}
		results = append(results, r)
	}
	return results, nil
}

// BufferOverview is what the Buffer tab opens with: the account, its
// organizations (with plan limits) and every channel.
type BufferOverview struct {
	Account       string                `json:"account"`
	Organizations []buffer.Organization `json:"organizations"`
	Channels      []buffer.Channel      `json:"channels"`
}

func (s *BufferService) Overview(ctx context.Context) (BufferOverview, error) {
	a, err := s.client.Account(ctx)
	if err != nil {
		return BufferOverview{}, err
	}
	channels, err := s.client.ChannelsIn(ctx, a.Organizations)
	if err != nil {
		return BufferOverview{}, err
	}
	name := a.Name
	if name == "" {
		name = a.Email
	}
	orgs := a.Organizations
	if orgs == nil {
		orgs = []buffer.Organization{}
	}
	o := BufferOverview{Account: name, Organizations: orgs, Channels: channels}
	s.cache.setOverview(o)
	return o, nil
}

// BufferCached is what the Buffer tab shows while fresh data loads: the
// last overview, if Buffer is still signed in. No network calls.
type BufferCached struct {
	Connected bool            `json:"connected"`
	Overview  *BufferOverview `json:"overview"`
}

func (s *BufferService) Cached() BufferCached {
	if !s.client.Connected() {
		return BufferCached{}
	}
	return BufferCached{Connected: true, Overview: s.cache.overview()}
}

// CachedPosts is the last first page of a post list, or nil.
func (s *BufferService) CachedPosts(q buffer.PostQuery) *buffer.PostPage {
	if !s.client.Connected() {
		return nil
	}
	q.After = ""
	return s.cache.posts(q)
}

// CachedIdeas is the last first page of an organization's ideas, or nil.
func (s *BufferService) CachedIdeas(orgID string) *buffer.IdeaPage {
	if !s.client.Connected() {
		return nil
	}
	return s.cache.ideas(orgID)
}

func (s *BufferService) Posts(ctx context.Context, q buffer.PostQuery) (buffer.PostPage, error) {
	page, err := s.client.Posts(ctx, q)
	if err == nil && q.After == "" {
		s.cache.setPosts(q, page)
	}
	return page, err
}

func (s *BufferService) DeletePost(ctx context.Context, id string) error {
	err := s.client.DeletePost(ctx, id)
	if err == nil {
		s.cache.removePost(id)
	}
	return err
}

// EditPost changes a post in Buffer. A post Relay sent about an article keeps
// that article's link, however the text is edited.
func (s *BufferService) EditPost(ctx context.Context, e buffer.PostEdit) (buffer.Post, error) {
	if url := s.posts.PromotionURL(e.ID); url != "" {
		e.Text = promotionText(e.Text, url)
	}
	p, err := s.client.EditPost(ctx, e)
	if err == nil {
		s.cache.replacePost(p)
	}
	return p, err
}

// Organizations lists the account's organizations, for views that only
// need to know which one to read.
func (s *BufferService) Organizations(ctx context.Context) ([]buffer.Organization, error) {
	a, err := s.client.Account(ctx)
	if err != nil {
		return nil, err
	}
	if a.Organizations == nil {
		return []buffer.Organization{}, nil
	}
	return a.Organizations, nil
}

func (s *BufferService) Ideas(ctx context.Context, orgID, after string) (buffer.IdeaPage, error) {
	page, err := s.client.Ideas(ctx, orgID, after)
	if err == nil && after == "" {
		s.cache.setIdeas(orgID, page)
	}
	return page, err
}

// PromotionPost is one promotion of a local article, with its Buffer post as
// Buffer has it now.
type PromotionPost struct {
	posts.Promotion
	// Found is false once the post is gone from Buffer (deleted there).
	Found        bool   `json:"found"`
	Status       string `json:"status"`
	DueAt        string `json:"dueAt"`
	SentAt       string `json:"sentAt"`
	ExternalLink string `json:"externalLink"`
	Error        string `json:"error"`
	// LookupError is set when Buffer couldn't be asked.
	LookupError string `json:"lookupError"`
}

// PromotionPosts looks up the Buffer posts a local article was promoted
// with, newest first.
func (s *BufferService) PromotionPosts(ctx context.Context, postID string) ([]PromotionPost, error) {
	p, err := s.posts.store.Get(postID)
	if err != nil {
		return nil, err
	}
	out := make([]PromotionPost, 0, len(p.Promotions))
	for i := len(p.Promotions) - 1; i >= 0; i-- {
		pr := p.Promotions[i]
		row := PromotionPost{Promotion: pr}
		bp, found, err := s.client.Post(ctx, pr.BufferID)
		switch {
		case err != nil:
			row.LookupError = err.Error()
		case found:
			row.Found, row.Status, row.DueAt, row.SentAt = true, bp.Status, bp.DueAt, bp.SentAt
			row.ExternalLink, row.Error = bp.ExternalLink, bp.Error
			if row.ChannelID == "" {
				row.ChannelID = bp.ChannelID
			}
			if row.Service == "" {
				row.Service = bp.ChannelService
			}
		}
		out = append(out, row)
	}
	return out, nil
}

func (s *BufferService) CreateIdea(ctx context.Context, n buffer.NewIdea) (buffer.Idea, error) {
	return s.client.CreateIdea(ctx, n)
}
