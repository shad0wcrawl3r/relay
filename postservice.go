package main

import (
	"context"
	"errors"
	"net/url"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/devto"
	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/shad0wcrawl3r/relay/internal/posts"
)

var (
	postLog  = logs.For("posts")
	devtoLog = logs.For("devto")
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
	// RemoteChanged: edited on Dev.to since Relay last sent or pulled it.
	RemoteChanged bool `json:"remoteChanged"`
	// Gone: sent to Dev.to, but the last good sync didn't list it, so it was
	// most likely deleted there.
	Gone bool `json:"gone"`
}

type PostList struct {
	Posts    []PostSummary `json:"posts"`
	SyncedAt time.Time     `json:"syncedAt"`
	Error    string        `json:"error"`
	// NoKey is set when there's no Dev.to key: writing still works locally.
	NoKey bool   `json:"noKey"`
	Dir   string `json:"dir"`
}

const remotePrefix = "devto-"

// imagePlaceholder starts the token the editor inserts for an image.
const imagePlaceholder = "<INSERT IMAGE HERE:"

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
	out := PostList{Posts: []PostSummary{}, SyncedAt: s.syncedAt, Error: s.syncErr, NoKey: config.GetConfig().DevTo.APIKey == "", Dir: s.store.Dir}
	seen := map[int]bool{}
	for _, p := range local {
		row := PostSummary{
			ID: p.ID, Title: p.Title, Local: true, DevtoID: p.DevtoID, URL: p.DevtoURL,
			UpdatedAt: p.UpdatedAt, SentAt: p.SentAt,
		}
		if a, ok := s.remote[p.DevtoID]; ok && p.DevtoID != 0 {
			seen[p.DevtoID] = true
			row.Published, row.PublishedAt, row.Views = a.Published, a.PublishedAt, a.PageViewsCount
			row.RemoteChanged, _ = remoteChanged(p, a)
			if a.URL != "" {
				row.URL = a.URL
			}
		} else if p.DevtoID != 0 && !s.syncedAt.IsZero() && s.syncErr == "" && s.syncedAt.Sub(p.SentAt) > 2*time.Minute {
			// A draft created moments ago can be missing from Dev.to's list for
			// a short while; only a sync well after the send counts.
			row.Gone = true
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
	if errors.Is(err, devto.ErrNoKey) {
		// Not an error: Relay works without Dev.to until the user sends a post.
		s.syncErr = ""
	} else if err != nil {
		devtoLog.Warn("sync failed", "error", err)
		s.syncErr = err.Error()
	} else {
		devtoLog.Debug("synced", "articles", len(arts))
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
	body, level := splitDisclosure(a.BodyMarkdown)
	if level == "" {
		level = AINone
	}
	p := posts.Post{Body: body, Meta: posts.Meta{
		AI:    level,
		Title: a.Title, Tags: a.TagList, Description: a.Description, CanonicalURL: a.CanonicalURL,
		DevtoID: a.ID, DevtoURL: a.URL, SentAt: parseTime(a.CreatedAt),
		DevtoHash: fingerprint(a.Title, a.BodyMarkdown),
	}}
	if a.Series != nil {
		p.Series = *a.Series
	}
	if p.CanonicalURL == a.URL {
		p.CanonicalURL = ""
	}
	postLog.Info("imported from Dev.to", "devto_id", a.ID)
	return s.store.Save(p)
}

func (s *PostService) Create() (posts.Post, error) {
	return s.store.Save(posts.Post{Meta: posts.Meta{Title: "Untitled post", AI: AIAssisted}})
}

// CreateFromIdea starts a local post from a Buffer idea: its title, or the
// text's first line when it has none, and the text as the opening notes.
func (s *PostService) CreateFromIdea(title, text string) (posts.Post, error) {
	title, body := ideaPost(title, text)
	p, err := s.store.Save(posts.Post{Meta: posts.Meta{Title: title, AI: AIAssisted}, Body: body})
	if err == nil {
		postLog.Info("post started from a Buffer idea", "id", p.ID)
	}
	return p, err
}

func ideaPost(title, text string) (string, string) {
	title, text = strings.TrimSpace(title), strings.TrimSpace(text)
	if title == "" {
		first, rest, _ := strings.Cut(text, "\n")
		first = strings.TrimSpace(strings.TrimLeft(first, "# "))
		if r := []rune(first); len(r) <= 100 {
			title, text = first, strings.TrimSpace(rest)
		} else {
			title = strings.TrimSpace(string(r[:80])) + "…"
		}
	}
	if title == "" {
		title = "Untitled post"
	}
	if text != "" {
		text += "\n"
	}
	return title, text
}

func (s *PostService) Save(p posts.Post) (posts.Post, error) {
	if len(p.Tags) > 4 {
		p.Tags = p.Tags[:4]
	}
	// The editor autosaves its own copy, which may predate a promotion or a
	// send; Go owns those fields.
	if old, err := s.store.Get(p.ID); err == nil {
		p.Promotions = old.Promotions
		p.DevtoHash = old.DevtoHash
	}
	saved, err := s.store.Save(p)
	if err != nil {
		postLog.Error("save failed", "id", p.ID, "error", err)
		return saved, err
	}
	postLog.Debug("saved", "id", saved.ID, "chars", len(saved.Body))
	return saved, nil
}

func (s *PostService) Delete(id string) error {
	postLog.Info("deleted", "id", id)
	return s.store.Delete(id)
}

func payload(p posts.Post) devto.Payload {
	return devto.Payload{
		Title: p.Title, BodyMarkdown: withDisclosure(p.Body, p.AI), Series: p.Series,
		CanonicalURL: p.CanonicalURL, Description: p.Description, Tags: strings.Join(p.Tags, ","),
	}
}

// SendResult is a send, or the drift that stopped it.
type SendResult struct {
	Post posts.Post `json:"post"`
	// Drift is set, and nothing sent, when Dev.to's copy changed since
	// Relay last sent or pulled it.
	Drift *Drift `json:"drift"`
}

// Send creates an unpublished Dev.to draft, or updates the existing article.
// An update first checks Dev.to's copy: if it was edited there since the
// last send, nothing is sent and the drift comes back for the user to
// resolve, unless overwrite is set.
func (s *PostService) Send(ctx context.Context, id string, overwrite bool) (SendResult, error) {
	p, err := s.store.Get(id)
	if err != nil {
		return SendResult{}, err
	}
	if p.DevtoID != 0 && !overwrite {
		d, err := s.drift(ctx, p)
		if err != nil {
			return SendResult{}, err
		}
		if d != nil {
			devtoLog.Notice("send held: changed on Dev.to", "id", id, "devto_id", p.DevtoID)
			return SendResult{Post: p, Drift: d}, nil
		}
	}
	payload := payload(p)
	var a devto.Article
	if p.DevtoID != 0 {
		a, err = devto.Update(ctx, p.DevtoID, payload)
	} else {
		a, err = devto.CreateDraft(ctx, payload)
	}
	if err != nil {
		devtoLog.Warn("send failed", "id", id, "error", err)
		return SendResult{}, err
	}
	devtoLog.Notice("sent", "id", id, "devto_id", a.ID, "overwrite", overwrite)
	p.DevtoID, p.SentAt = a.ID, time.Now()
	if a.URL != "" {
		p.DevtoURL = a.URL
	}
	// What Dev.to now holds, as it reports it (it may normalise the text).
	p.DevtoHash = fingerprint(a.Title, firstNonEmpty(a.BodyMarkdown, payload.BodyMarkdown))
	s.mu.Lock()
	s.remote[a.ID] = a
	s.mu.Unlock()
	saved, err := s.store.Save(p)
	return SendResult{Post: saved}, err
}

// Publish makes a post live on Dev.to. It only runs on the user's explicit
// request. The article goes live as it stands there, so the placeholder check
// reads Dev.to's copy: images are usually swapped in on Dev.to, not here.
func (s *PostService) Publish(ctx context.Context, id string) (posts.Post, error) {
	p, err := s.store.Get(id)
	if err != nil {
		return posts.Post{}, err
	}
	if p.DevtoID == 0 {
		return posts.Post{}, errors.New("send this post to Dev.to first")
	}
	s.Sync(ctx)
	if strings.Contains(s.articleBody(p), imagePlaceholder) {
		devtoLog.Notice("publish refused: image placeholders remain", "id", id)
		return posts.Post{}, errors.New("replace the image placeholders on Dev.to before publishing")
	}
	a, err := devto.Publish(ctx, p.DevtoID)
	if err != nil {
		devtoLog.Warn("publish failed", "id", id, "error", err)
		return posts.Post{}, err
	}
	devtoLog.Notice("published", "id", id, "devto_id", a.ID)
	if a.URL != "" {
		p.DevtoURL = a.URL
	}
	s.mu.Lock()
	s.remote[a.ID] = a
	s.mu.Unlock()
	return s.store.Save(p)
}

// articleBody is the article as Dev.to has it, falling back to the local copy.
// The two differ once the user edits on Dev.to.
func (s *PostService) articleBody(p posts.Post) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if a, ok := s.remote[p.DevtoID]; ok && p.DevtoID != 0 && a.BodyMarkdown != "" {
		return a.BodyMarkdown
	}
	return p.Body
}

// PublishedURL returns the live article's link, or an error if Dev.to hasn't
// published it.
func (s *PostService) PublishedURL(id string) (string, error) {
	p, err := s.store.Get(id)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	a, ok := s.remote[p.DevtoID]
	s.mu.Unlock()
	if !ok || p.DevtoID == 0 || !a.Published || a.URL == "" {
		return "", errors.New("this post isn't published on Dev.to yet")
	}
	return a.URL, nil
}

// PromotionURL returns the article link of the local post that promoted
// bufferID, or "" when Relay didn't send that Buffer post.
func (s *PostService) PromotionURL(bufferID string) string {
	if bufferID == "" {
		return ""
	}
	local, err := s.store.List()
	if err != nil {
		postLog.Warn("could not list posts", "error", err)
		return ""
	}
	for _, p := range local {
		for _, pr := range p.Promotions {
			if pr.BufferID != bufferID {
				continue
			}
			if url, err := s.PublishedURL(p.ID); err == nil {
				return url
			}
			return p.DevtoURL
		}
	}
	return ""
}

// RecordPromotion notes a post sent to Buffer on the local article.
func (s *PostService) RecordPromotion(id string, promo posts.Promotion) (posts.Post, error) {
	p, err := s.store.Get(id)
	if err != nil {
		return posts.Post{}, err
	}
	p.Promotions = append(p.Promotions, promo)
	return s.store.Save(p)
}

// Series lists the series already in use, across local posts and Dev.to.
func (s *PostService) Series() ([]string, error) {
	local, err := s.store.List()
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, p := range local {
		if p.Series != "" {
			seen[p.Series] = true
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.remote {
		if a.Series != nil && *a.Series != "" {
			seen[*a.Series] = true
		}
	}
	out := make([]string, 0, len(seen))
	for name := range seen {
		out = append(out, name)
	}
	sort.Strings(out)
	return out, nil
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

// Unpublish turns a published article back into a Dev.to draft. Like
// publishing, it only runs on the user's explicit, confirmed request.
func (s *PostService) Unpublish(ctx context.Context, id string) (posts.Post, error) {
	p, err := s.store.Get(id)
	if err != nil {
		return posts.Post{}, err
	}
	if p.DevtoID == 0 {
		return posts.Post{}, errors.New("this post isn't on Dev.to")
	}
	a, err := devto.Unpublish(ctx, p.DevtoID)
	if err != nil {
		devtoLog.Warn("unpublish failed", "id", id, "error", err)
		return posts.Post{}, err
	}
	devtoLog.Notice("unpublished", "id", id, "devto_id", a.ID)
	if a.URL != "" {
		p.DevtoURL = a.URL
	}
	s.mu.Lock()
	if a.ID != 0 {
		s.remote[a.ID] = a
	}
	s.mu.Unlock()
	return s.store.Save(p)
}

// DeleteURL is the page on Dev.to that deletes the article. Forem's API has
// no way to delete one, so the last step happens there, signed in as the
// author.
func (s *PostService) DeleteURL(id string) (string, error) {
	p, err := s.store.Get(id)
	if err != nil {
		return "", err
	}
	if p.DevtoID == 0 {
		return "", errors.New("this post isn't on Dev.to")
	}
	s.mu.Lock()
	a, ok := s.remote[p.DevtoID]
	s.mu.Unlock()
	link := p.DevtoURL
	if ok && a.URL != "" {
		link = a.URL
	}
	u, err := url.Parse(link)
	if err != nil || u.Scheme != "https" || (u.Host != "dev.to" && !strings.HasSuffix(u.Host, ".dev.to")) || strings.Count(strings.Trim(u.Path, "/"), "/") != 1 {
		return "https://dev.to/dashboard", nil
	}
	u.RawQuery, u.Fragment = "", ""
	u.Path = strings.TrimSuffix(u.Path, "/") + "/delete_confirm"
	return u.String(), nil
}

// Unlink makes a post local again: it forgets the Dev.to article (after it
// was deleted there, or to start over). The local text stays. Its promotion
// records go too: they link to the old article, so the post would otherwise
// still read as promoted, and a later send makes a new article.
func (s *PostService) Unlink(id string) (posts.Post, error) {
	p, err := s.store.Get(id)
	if err != nil {
		return posts.Post{}, err
	}
	devtoLog.Notice("unlinked from Dev.to", "id", id, "devto_id", p.DevtoID)
	p.DevtoID, p.DevtoURL, p.DevtoHash, p.SentAt, p.Promotions = 0, "", "", time.Time{}, nil
	return s.store.Save(p)
}
