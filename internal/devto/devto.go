// Package devto talks to the Forem/Dev.to articles API.
package devto

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
)

// baseURL is Dev.to's API; tests point it at a local server.
var baseURL = "https://dev.to/api"

var httpClient = &http.Client{Timeout: 30 * time.Second, Transport: logs.Transport("devto", nil)}

var ErrNoKey = errors.New("dev.to: no API key; add it in Settings")

type Article struct {
	ID             int       `json:"id"`
	Title          string    `json:"title"`
	Description    string    `json:"description"`
	Published      bool      `json:"published"`
	PublishedAt    string    `json:"published_at"`
	URL            string    `json:"url"`
	CanonicalURL   string    `json:"canonical_url"`
	BodyMarkdown   string    `json:"body_markdown"`
	TagList        flexTags  `json:"tag_list"`
	PageViewsCount int       `json:"page_views_count"`
	Series         *string   `json:"series"`
	EditedAt       string    `json:"edited_at"`
	CreatedAt      string    `json:"created_at"`
	FetchedAt      time.Time `json:"-"`
}

// flexTags accepts tag_list as either an array or a comma-separated string;
// the API uses both depending on the endpoint.
type flexTags []string

func (f *flexTags) UnmarshalJSON(b []byte) error {
	var arr []string
	if json.Unmarshal(b, &arr) == nil {
		*f = arr
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	*f = nil
	for _, t := range strings.Split(s, ",") {
		if t = strings.TrimSpace(t); t != "" {
			*f = append(*f, t)
		}
	}
	return nil
}

// Payload is what Relay sends. Published is a pointer so updates can omit it:
// re-sending a draft must never unpublish an article that went live on Dev.to.
type Payload struct {
	Title        string `json:"title"`
	BodyMarkdown string `json:"body_markdown"`
	Published    *bool  `json:"published,omitempty"`
	Series       string `json:"series,omitempty"`
	CanonicalURL string `json:"canonical_url,omitempty"`
	Description  string `json:"description,omitempty"`
	Tags         string `json:"tags,omitempty"`
}

func do(ctx context.Context, method, path string, body, out any) error {
	return doKey(ctx, config.GetConfig().DevTo.APIKey, method, path, body, out)
}

func doKey(ctx context.Context, key, method, path string, body, out any) error {
	if key == "" {
		return ErrNoKey
	}
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, baseURL+path, r)
	if err != nil {
		return err
	}
	req.Header.Set("api-key", key)
	req.Header.Set("Accept", "application/vnd.forem.api-v1+json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return ErrBadKey
	}
	if resp.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(data, &e) == nil && e.Error != "" {
			return fmt.Errorf("dev.to: %s", e.Error)
		}
		return fmt.Errorf("dev.to: %s", resp.Status)
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

// User is the account an API key belongs to.
type User struct {
	Username string `json:"username"`
	Name     string `json:"name"`
}

// ErrBadKey means Dev.to refused the API key.
var ErrBadKey = errors.New("Dev.to didn't accept this API key")

// Check confirms a key works before it's saved, and says whose it is.
func Check(ctx context.Context, key string) (User, error) {
	key = strings.TrimSpace(key)
	var u User
	if err := doKey(ctx, key, http.MethodGet, "/users/me", nil, &u); err != nil {
		return User{}, err
	}
	return u, nil
}

// Mine lists all of the user's articles, published and unpublished.
func Mine(ctx context.Context) ([]Article, error) {
	var all []Article
	for page := 1; ; page++ {
		var batch []Article
		if err := do(ctx, http.MethodGet, "/articles/me/all?per_page=1000&page="+strconv.Itoa(page), nil, &batch); err != nil {
			return nil, err
		}
		all = append(all, batch...)
		if len(batch) < 1000 {
			return all, nil
		}
	}
}

// CreateDraft creates an unpublished article.
func CreateDraft(ctx context.Context, p Payload) (Article, error) {
	f := false
	p.Published = &f
	var a Article
	err := do(ctx, http.MethodPost, "/articles", map[string]any{"article": p}, &a)
	return a, err
}

// Publish makes an article live as it stands on Dev.to, so edits made there
// (like adding images) survive.
func Publish(ctx context.Context, id int) (Article, error) {
	var a Article
	err := do(ctx, http.MethodPut, "/articles/"+strconv.Itoa(id), map[string]any{"article": map[string]bool{"published": true}}, &a)
	return a, err
}

// Update edits an existing article without changing its published state.
func Update(ctx context.Context, id int, p Payload) (Article, error) {
	p.Published = nil
	var a Article
	err := do(ctx, http.MethodPut, "/articles/"+strconv.Itoa(id), map[string]any{"article": p}, &a)
	return a, err
}

// Unpublish turns a published article back into a draft. It's the article
// update with published false: Forem's /unpublish endpoint is for admins and
// moderators only. Comments and the URL stay; it leaves feeds and search.
func Unpublish(ctx context.Context, id int) (Article, error) {
	var a Article
	err := do(ctx, http.MethodPut, "/articles/"+strconv.Itoa(id), map[string]any{"article": map[string]bool{"published": false}}, &a)
	return a, err
}

// SetBaseURL points the client at another server, for tests. It returns the
// previous URL.
func SetBaseURL(u string) string {
	old := baseURL
	baseURL = u
	return old
}
