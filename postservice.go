package main

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/devto"
	"github.com/shad0wcrawl3r/relay/internal/posts"
)

// PostService manages local markdown posts and mirrors them to Dev.to.
type PostService struct {
	store *posts.Store

	mu       sync.Mutex
	remote   map[int]devto.Article
	syncedAt time.Time
	syncErr  string
}

// PostSummary is one row in the posts sidebar.
type PostSummary struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Local       bool      `json:"local"`
	DevtoID     int       `json:"devtoId"`
	Published   bool      `json:"published"`
	PublishedAt string    `json:"publishedAt"`
	Views       int       `json:"views"`
	URL         string    `json:"url"`
	UpdatedAt   time.Time `json:"updatedAt"`
	SentAt      time.Time `json:"sentAt"`
}

type PostList struct {
	Posts    []PostSummary `json:"posts"`
	SyncedAt time.Time     `json:"syncedAt"`
	Error    string        `json:"error"`
	Dir      string        `json:"dir"`
}

const remotePrefix = "devto-"

func NewPostService() (*PostService, error) {
	store, err := posts.NewStore(filepath.Join(config.AppDir(), "posts"))
	if err != nil {
		return nil, err
	}
	return &PostService{store: store, remote: map[int]devto.Article{}}, nil
}

// List merges local files with the last-fetched Dev.to articles.
func (s *PostService) List() (PostList, error) {
	local, err := s.store.List()
	if err != nil {
		return PostList{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := PostList{Posts: []PostSummary{}, SyncedAt: s.syncedAt, Error: s.syncErr, Dir: s.store.Dir}
	seen := map[int]bool{}
	for _, p := range local {
		row := PostSummary{
			ID: p.ID, Title: p.Title, Local: true, DevtoID: p.DevtoID, URL: p.DevtoURL,
			UpdatedAt: p.UpdatedAt, SentAt: p.SentAt,
		}
		if a, ok := s.remote[p.DevtoID]; ok && p.DevtoID != 0 {
			seen[p.DevtoID] = true
			row.Published, row.PublishedAt, row.Views = a.Published, a.PublishedAt, a.PageViewsCount
			if a.URL != "" {
				row.URL = a.URL
			}
		}
		out.Posts = append(out.Posts, row)
	}
	for id, a := range s.remote {
		if seen[id] {
			continue
		}
		out.Posts = append(out.Posts, PostSummary{
			ID: remotePrefix + strconv.Itoa(id), Title: a.Title, DevtoID: id, Published: a.Published,
			PublishedAt: a.PublishedAt, Views: a.PageViewsCount, URL: a.URL, SentAt: parseTime(a.CreatedAt),
			UpdatedAt: parseTime(firstNonEmpty(a.EditedAt, a.PublishedAt, a.CreatedAt)),
		})
	}
	sort.SliceStable(out.Posts, func(i, j int) bool {
		a, b := out.Posts[i], out.Posts[j]
		if a.Published != b.Published {
			return !a.Published
		}
		if a.Published {
			return a.PublishedAt > b.PublishedAt
		}
		return a.UpdatedAt.After(b.UpdatedAt)
	})
	return out, nil
}

// Sync refreshes the Dev.to article list.
func (s *PostService) Sync(ctx context.Context) (PostList, error) {
	arts, err := devto.Mine(ctx)
	s.mu.Lock()
	if err != nil {
		s.syncErr = err.Error()
	} else {
		s.syncErr = ""
		s.syncedAt = time.Now()
		s.remote = map[int]devto.Article{}
		for _, a := range arts {
			s.remote[a.ID] = a
		}
	}
	s.mu.Unlock()
	return s.List()
}

// Get loads a post; a Dev.to-only article is imported into a local file first.
func (s *PostService) Get(id string) (posts.Post, error) {
	if !strings.HasPrefix(id, remotePrefix) {
		return s.store.Get(id)
	}
	devID, err := strconv.Atoi(strings.TrimPrefix(id, remotePrefix))
	if err != nil {
		return posts.Post{}, err
	}
	s.mu.Lock()
	a, ok := s.remote[devID]
	s.mu.Unlock()
	if !ok {
		return posts.Post{}, errors.New("article not found; sync with Dev.to")
	}
	p := posts.Post{Body: a.BodyMarkdown, Meta: posts.Meta{
		Title: a.Title, Tags: a.TagList, Description: a.Description, CanonicalURL: a.CanonicalURL,
		DevtoID: a.ID, DevtoURL: a.URL, SentAt: parseTime(a.CreatedAt),
	}}
	if a.Series != nil {
		p.Series = *a.Series
	}
	if p.CanonicalURL == a.URL {
		p.CanonicalURL = ""
	}
	return s.store.Save(p)
}

func (s *PostService) Create() (posts.Post, error) {
	return s.store.Save(posts.Post{Meta: posts.Meta{Title: "Untitled post"}})
}

func (s *PostService) Save(p posts.Post) (posts.Post, error) {
	if len(p.Tags) > 4 {
		p.Tags = p.Tags[:4]
	}
	return s.store.Save(p)
}

func (s *PostService) Delete(id string) error {
	return s.store.Delete(id)
}

// Send creates an unpublished Dev.to draft, or updates the existing article.
func (s *PostService) Send(ctx context.Context, id string) (posts.Post, error) {
	p, err := s.store.Get(id)
	if err != nil {
		return posts.Post{}, err
	}
	payload := devto.Payload{
		Title: p.Title, BodyMarkdown: p.Body, Series: p.Series,
		CanonicalURL: p.CanonicalURL, Description: p.Description, Tags: strings.Join(p.Tags, ","),
	}
	var a devto.Article
	if p.DevtoID != 0 {
		a, err = devto.Update(ctx, p.DevtoID, payload)
	} else {
		a, err = devto.CreateDraft(ctx, payload)
	}
	if err != nil {
		return posts.Post{}, err
	}
	p.DevtoID, p.SentAt = a.ID, time.Now()
	if a.URL != "" {
		p.DevtoURL = a.URL
	}
	s.mu.Lock()
	s.remote[a.ID] = a
	s.mu.Unlock()
	return s.store.Save(p)
}

func parseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	return t
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}
