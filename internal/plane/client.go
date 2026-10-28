package plane

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

var httpClient = &http.Client{Timeout: 30 * time.Second}

// client is a thin Plane REST v1 client. Plane rate-limits per token, so all
// requests share a small token bucket.
type client struct {
	auth   *auth
	bucket *bucket
}

type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("plane: %d %s", e.Status, e.Body)
}

// resolve maps a workspace-relative path to a URL; paths starting with
// "/api/" are taken as absolute API paths.
func (c *client) resolve(t *Token, path string) string {
	base := baseURL(config.GetConfig())
	if strings.HasPrefix(path, "/api/") {
		return base + path
	}
	return base + "/api/v1/workspaces/" + url.PathEscape(t.Workspace) + path
}

func (c *client) do(ctx context.Context, method, path string, body, out any) error {
	t, err := c.auth.valid(ctx)
	if err != nil {
		return err
	}
	var payload []byte
	if body != nil {
		if payload, err = json.Marshal(body); err != nil {
			return err
		}
	}
	for attempt := 0; ; attempt++ {
		if err := c.bucket.wait(ctx); err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, method, c.resolve(t, path), bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+t.AccessToken)
		req.Header.Set("Accept", "application/json")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			return err
		}
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
		resp.Body.Close()

		switch {
		case resp.StatusCode == http.StatusUnauthorized && attempt == 0:
			if t, err = c.auth.refresh(ctx, t); err != nil {
				return err
			}
			continue
		case resp.StatusCode == http.StatusTooManyRequests && attempt < 3:
			wait := 5 * time.Second
			if s, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil {
				wait = time.Duration(s) * time.Second
			}
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return ctx.Err()
			}
			continue
		case resp.StatusCode >= 300:
			// Don't echo bodies at length: they can carry item content.
			msg := string(data)
			if len(msg) > 200 {
				msg = msg[:200]
			}
			return &APIError{Status: resp.StatusCode, Body: msg}
		}
		if out != nil && len(data) > 0 {
			return json.Unmarshal(data, out)
		}
		return nil
	}
}

type page[T any] struct {
	Results         []T    `json:"results"`
	NextCursor      string `json:"next_cursor"`
	NextPageResults bool   `json:"next_page_results"`
}

// list follows Plane's cursor pagination. Endpoints that return a bare array
// are handled too.
func list[T any](ctx context.Context, c *client, path string, params url.Values) ([]T, error) {
	if params == nil {
		params = url.Values{}
	}
	params.Set("per_page", "100")
	var all []T
	for {
		var raw json.RawMessage
		if err := c.do(ctx, http.MethodGet, path+"?"+params.Encode(), nil, &raw); err != nil {
			return nil, err
		}
		var arr []T
		if json.Unmarshal(raw, &arr) == nil {
			return append(all, arr...), nil
		}
		var p page[T]
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, err
		}
		all = append(all, p.Results...)
		if !p.NextPageResults || p.NextCursor == "" {
			return all, nil
		}
		params.Set("cursor", p.NextCursor)
	}
}

// ref decodes a field Plane returns either as an id string or as an
// expanded object with an id.
type ref string

func (r *ref) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		*r = ""
		return nil
	}
	var s string
	if json.Unmarshal(b, &s) == nil {
		*r = ref(s)
		return nil
	}
	var o struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(b, &o); err != nil {
		return err
	}
	*r = ref(o.ID)
	return nil
}

type rawProject struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Identifier string `json:"identifier"`
	ArchivedAt string `json:"archived_at"`
}

type rawState struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Color    string  `json:"color"`
	Group    string  `json:"group"`
	Sequence float64 `json:"sequence"`
	Default  bool    `json:"default"`
}

type rawLabel struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type rawModule struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

type rawCycle struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
}

type rawMember struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	IsBot       bool   `json:"is_bot"`
}

func (m rawMember) name() string {
	if m.DisplayName != "" {
		return m.DisplayName
	}
	if m.FirstName != "" {
		return m.FirstName
	}
	return "Someone"
}

type rawItem struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	SequenceID      int        `json:"sequence_id"`
	State           ref        `json:"state"`
	Priority        string     `json:"priority"`
	Labels          []ref      `json:"labels"`
	TargetDate      string     `json:"target_date"`
	CreatedAt       string     `json:"created_at"`
	UpdatedAt       string     `json:"updated_at"`
	CreatedBy       ref        `json:"created_by"`
	DescriptionHTML string     `json:"description_html"`
	ArchivedAt      string     `json:"archived_at"`
	Module          ref        `json:"module"`
	Cycle           ref        `json:"cycle"`
	ModuleIDs       []ref      `json:"module_ids"`
	CreatedByDetail *rawMember `json:"created_by_detail"`
}

// rawMembership is a row from module-issues / cycle-issues.
type rawMembership struct {
	ID    string `json:"id"`
	Issue ref    `json:"issue"`
}

type rawComment struct {
	ID          string     `json:"id"`
	CommentHTML string     `json:"comment_html"`
	CreatedAt   string     `json:"created_at"`
	CreatedBy   ref        `json:"created_by"`
	Actor       ref        `json:"actor"`
	ActorDetail *rawMember `json:"actor_detail"`
}

type rawActivity struct {
	ID          string     `json:"id"`
	Verb        string     `json:"verb"`
	Field       string     `json:"field"`
	OldValue    string     `json:"old_value"`
	NewValue    string     `json:"new_value"`
	Comment     string     `json:"comment"`
	CreatedAt   string     `json:"created_at"`
	Actor       ref        `json:"actor"`
	ActorDetail *rawMember `json:"actor_detail"`
}

// bucket is a token bucket: burst `size`, refilled one token per `every`.
type bucket struct {
	mu     sync.Mutex
	tokens float64
	size   float64
	every  time.Duration
	last   time.Time
}

func newBucket(size int, every time.Duration) *bucket {
	return &bucket{tokens: float64(size), size: float64(size), every: every, last: time.Now()}
}

func (b *bucket) wait(ctx context.Context) error {
	for {
		b.mu.Lock()
		now := time.Now()
		b.tokens += float64(now.Sub(b.last)) / float64(b.every)
		if b.tokens > b.size {
			b.tokens = b.size
		}
		b.last = now
		if b.tokens >= 1 {
			b.tokens--
			b.mu.Unlock()
			return nil
		}
		need := time.Duration((1 - b.tokens) * float64(b.every))
		b.mu.Unlock()
		select {
		case <-time.After(need):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
