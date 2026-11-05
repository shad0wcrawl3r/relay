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
}

func NewBufferService(posts *PostService) *BufferService {
	s := &BufferService{client: buffer.New(), posts: posts}
	// Buffer can end the sign-in on its side (revoked, refresh refused).
	s.client.OnSignOut = func() { integrationsChanged(s) }
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
	err := s.client.Connect(ctx, func(u string) { _ = application.Get().Browser.OpenURL(u) })
	if err != nil {
		return BufferStatus{}, err
	}
	integrationsChanged(s)
	return s.Status(ctx), nil
}

func (s *BufferService) Disconnect() error {
	err := s.client.Disconnect()
	integrationsChanged(s)
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
	return withLink(text, url), nil
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
		ChannelID: in.ChannelID, Text: withLink(in.Text, url), Timing: in.Timing, DueAt: in.DueAt,
	})
	if err != nil {
		return posts.Post{}, err
	}
	return s.posts.RecordPromotion(in.PostID, posts.Promotion{
		BufferID: bufferID, Channel: in.Channel, Timing: string(in.Timing), DueAt: in.DueAt, At: time.Now(),
	})
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
		e.Text = withLink(e.Text, url)
	}
	return s.client.EditPost(ctx, e)
}

func (s *BufferService) Ideas(ctx context.Context, orgID, after string) (buffer.IdeaPage, error) {
	return s.client.Ideas(ctx, orgID, after)
}

func (s *BufferService) CreateIdea(ctx context.Context, n buffer.NewIdea) (buffer.Idea, error) {
	return s.client.CreateIdea(ctx, n)
}
