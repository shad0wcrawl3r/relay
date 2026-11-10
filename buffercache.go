package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/shad0wcrawl3r/relay/internal/vault"
)

// bufferCache keeps the last answers the Buffer tab got (the overview, the
// first page of each post list and of ideas) so the tab opens on them at
// once while fresh ones load. Like the Plane cache it's encrypted through
// internal/vault, and it's dropped when Buffer signs out.
type bufferCache struct {
	mu   sync.Mutex
	path string
	data bufferCacheData
	// loaded is false until the file has been read; reads load it lazily so
	// startup doesn't wait on the keychain.
	loaded bool
}

type bufferCacheData struct {
	Overview *BufferOverview            `json:"overview,omitempty"`
	Posts    map[string]buffer.PostPage `json:"posts,omitempty"`
	Ideas    map[string]buffer.IdeaPage `json:"ideas,omitempty"`
	SavedAt  time.Time                  `json:"savedAt"`
}

// maxCachedLists bounds the post lists kept: one per tab, organization and
// channel filter the user has opened.
const maxCachedLists = 60

var cacheLog = logs.For("buffer")

func newBufferCache(path string) *bufferCache { return &bufferCache{path: path} }

func bufferCachePath() string { return filepath.Join(config.AppDir(), "buffer-cache.json") }

func postsKey(q buffer.PostQuery) string {
	return q.OrganizationID + "|" + strings.Join(q.Statuses, ",") + "|" + strings.Join(q.ChannelIDs, ",")
}

// load reads the file once. Caller holds mu.
func (c *bufferCache) load() {
	if c.loaded {
		return
	}
	c.loaded = true
	b, err := vault.ReadFile(c.path)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			cacheLog.Warn("cache unreadable, starting empty", "error", err)
		}
		return
	}
	var d bufferCacheData
	if err := json.Unmarshal(b, &d); err != nil {
		cacheLog.Warn("cache unreadable, starting empty", "error", err)
		return
	}
	c.data = d
}

// save writes the cache. Caller holds mu.
func (c *bufferCache) save() {
	c.data.SavedAt = time.Now()
	b, err := json.Marshal(c.data)
	if err == nil {
		err = vault.WriteFile(c.path, b)
	}
	if err != nil {
		cacheLog.Warn("could not save the cache", "error", err)
	}
}

func (c *bufferCache) overview() *BufferOverview {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	return c.data.Overview
}

func (c *bufferCache) setOverview(o BufferOverview) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	c.data.Overview = &o
	c.save()
}

func (c *bufferCache) posts(q buffer.PostQuery) *buffer.PostPage {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	if p, ok := c.data.Posts[postsKey(q)]; ok {
		return &p
	}
	return nil
}

func (c *bufferCache) setPosts(q buffer.PostQuery, page buffer.PostPage) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	if c.data.Posts == nil {
		c.data.Posts = map[string]buffer.PostPage{}
	}
	key := postsKey(q)
	if _, ok := c.data.Posts[key]; !ok && len(c.data.Posts) >= maxCachedLists {
		// Rarely reached; start over rather than track ages.
		c.data.Posts = map[string]buffer.PostPage{}
	}
	c.data.Posts[key] = page
	c.save()
}

func (c *bufferCache) ideas(orgID string) *buffer.IdeaPage {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	if p, ok := c.data.Ideas[orgID]; ok {
		return &p
	}
	return nil
}

func (c *bufferCache) setIdeas(orgID string, page buffer.IdeaPage) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	if c.data.Ideas == nil {
		c.data.Ideas = map[string]buffer.IdeaPage{}
	}
	c.data.Ideas[orgID] = page
	c.save()
}

// editPosts applies fn to every cached list, so a deleted or edited post
// doesn't flash back in its old form before the next load.
func (c *bufferCache) editPosts(fn func([]buffer.Post) []buffer.Post) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	if len(c.data.Posts) == 0 {
		return
	}
	for k, page := range c.data.Posts {
		page.Posts = fn(page.Posts)
		c.data.Posts[k] = page
	}
	c.save()
}

func (c *bufferCache) removePost(id string) {
	c.editPosts(func(ps []buffer.Post) []buffer.Post {
		out := ps[:0:0]
		for _, p := range ps {
			if p.ID != id {
				out = append(out, p)
			}
		}
		return out
	})
}

func (c *bufferCache) replacePost(np buffer.Post) {
	c.editPosts(func(ps []buffer.Post) []buffer.Post {
		out := make([]buffer.Post, len(ps))
		for i, p := range ps {
			if p.ID == np.ID {
				p = np
			}
			out[i] = p
		}
		return out
	})
}

// clear forgets everything, on disk too: another account may sign in next.
func (c *bufferCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.loaded = true
	c.data = bufferCacheData{}
	if err := os.Remove(c.path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		cacheLog.Warn("could not delete the cache", "error", err)
	}
}
