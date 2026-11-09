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
}

func NewBufferService(posts *PostService, plane *PlaneService) *BufferService {
	s := &BufferService{client: buffer.New(), posts: posts, plane: plane, links: newIdeaLinks(ideaLinksPath())}
	// Buffer can end the sign-in on its side (revoked, refresh refused).
	s.client.OnSignOut = func() {
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
		BufferID: bufferID, Channel: in.Channel, Timing: string(in.Timing), DueAt: in.DueAt, At: time.Now(),
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
	return BufferOverview{Account: name, Organizations: orgs, Channels: channels}, nil
}

func (s *BufferService) Posts(ctx context.Context, q buffer.PostQuery) (buffer.PostPage, error) {
	return s.client.Posts(ctx, q)
}

func (s *BufferService) DeletePost(ctx context.Context, id string) error {
	return s.client.DeletePost(ctx, id)
}

// EditPost changes a post in Buffer. A post Relay sent about an article keeps
// that article's link, however the text is edited.
func (s *BufferService) EditPost(ctx context.Context, e buffer.PostEdit) (buffer.Post, error) {
	if url := s.posts.PromotionURL(e.ID); url != "" {
		e.Text = promotionText(e.Text, url)
	}
	return s.client.EditPost(ctx, e)
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
	return s.client.Ideas(ctx, orgID, after)
}

func (s *BufferService) CreateIdea(ctx context.Context, n buffer.NewIdea) (buffer.Idea, error) {
	return s.client.CreateIdea(ctx, n)
}
