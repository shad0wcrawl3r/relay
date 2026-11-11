// Package posts stores Dev.to drafts as markdown files with YAML front
// matter in the OS app-storage dir. The body after the front matter is the
// exact markdown sent to Dev.to; the front matter never leaves the machine.
package posts

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"
)

type Meta struct {
	Title        string   `yaml:"title" json:"title"`
	Tags         []string `yaml:"tags,flow" json:"tags"`
	Series       string   `yaml:"series,omitempty" json:"series"`
	Description  string   `yaml:"description,omitempty" json:"description"`
	CanonicalURL string   `yaml:"canonical_url,omitempty" json:"canonicalUrl"`
	// AI is how much AI went into the post: "none", "assisted" or
	// "generated". Sending adds a matching line for Dev.to; empty is "none".
	AI       string    `yaml:"ai,omitempty" json:"ai"`
	DevtoID  int       `yaml:"devto_id,omitempty" json:"devtoId"`
	DevtoURL string    `yaml:"devto_url,omitempty" json:"devtoUrl"`
	SentAt   time.Time `yaml:"sent_at,omitempty" json:"sentAt"`
	// DevtoHash fingerprints Dev.to's copy (title and body) as of the last
	// send or pull, so edits made on Dev.to since then can be spotted.
	DevtoHash string `yaml:"devto_hash,omitempty" json:"devtoHash"`
	// Promotions records what went to Buffer for this post.
	Promotions []Promotion `yaml:"promotions,omitempty" json:"promotions"`
	// PlaneItems are the Plane work items the post is about: IDs only,
	// never titles, so a locked project's names don't end up in a post file.
	PlaneItems []PlaneLink `yaml:"plane_items,omitempty" json:"planeItems"`
	UpdatedAt  time.Time   `yaml:"updated_at" json:"updatedAt"`
}

// PlaneLink points at a Plane work item.
type PlaneLink struct {
	ProjectID string `yaml:"project_id" json:"projectId"`
	ItemID    string `yaml:"item_id" json:"itemId"`
}

// Promotion is one post sent to Buffer about this article.
type Promotion struct {
	BufferID string `yaml:"buffer_id" json:"bufferId"`
	Channel  string `yaml:"channel" json:"channel"`
	// ChannelID and Service are empty on promotions from before Relay
	// kept them.
	ChannelID string    `yaml:"channel_id,omitempty" json:"channelId"`
	Service   string    `yaml:"service,omitempty" json:"service"`
	Timing    string    `yaml:"timing" json:"timing"`
	DueAt     time.Time `yaml:"due_at,omitempty" json:"dueAt"`
	At        time.Time `yaml:"at" json:"at"`
}

type Post struct {
	ID string `json:"id"`
	Meta
	Body string `json:"body"`
}

type Store struct {
	Dir string
}

func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Store{Dir: dir}, nil
}

func (s *Store) path(id string) (string, error) {
	if id == "" || strings.ContainsAny(id, `/\.`) {
		return "", fmt.Errorf("posts: bad id %q", id)
	}
	return filepath.Join(s.Dir, id+".md"), nil
}

func NewID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return time.Now().Format("20060102") + "-" + hex.EncodeToString(b)
}

func (s *Store) List() ([]Post, error) {
	entries, err := os.ReadDir(s.Dir)
	if err != nil {
		return nil, err
	}
	var out []Post
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		p, err := s.Get(strings.TrimSuffix(e.Name(), ".md"))
		if err != nil {
			continue
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

func (s *Store) Get(id string) (Post, error) {
	path, err := s.path(id)
	if err != nil {
		return Post{}, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return Post{}, err
	}
	p := Post{ID: id}
	body := raw
	if bytes.HasPrefix(raw, []byte("---\n")) {
		rest := raw[4:]
		if end := bytes.Index(rest, []byte("\n---\n")); end >= 0 {
			if err := yaml.Unmarshal(rest[:end], &p.Meta); err != nil {
				return Post{}, err
			}
			body = rest[end+5:]
		}
	}
	p.Body = string(body)
	if p.Tags == nil {
		p.Tags = []string{}
	}
	if p.UpdatedAt.IsZero() {
		if fi, err := os.Stat(path); err == nil {
			p.UpdatedAt = fi.ModTime()
		}
	}
	return p, nil
}

// Save writes atomically (temp file + rename) so a crash never truncates a post.
func (s *Store) Save(p Post) (Post, error) {
	if p.ID == "" {
		p.ID = NewID()
	}
	path, err := s.path(p.ID)
	if err != nil {
		return Post{}, err
	}
	p.UpdatedAt = time.Now()
	if p.Tags == nil {
		p.Tags = []string{}
	}
	fm, err := yaml.Marshal(p.Meta)
	if err != nil {
		return Post{}, err
	}
	var buf bytes.Buffer
	buf.WriteString("---\n")
	buf.Write(fm)
	buf.WriteString("---\n")
	buf.WriteString(p.Body)
	tmp, err := os.CreateTemp(s.Dir, ".tmp-*")
	if err != nil {
		return Post{}, err
	}
	if _, err := tmp.Write(buf.Bytes()); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return Post{}, err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return Post{}, err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return Post{}, err
	}
	return p, nil
}

func (s *Store) Delete(id string) error {
	path, err := s.path(id)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
