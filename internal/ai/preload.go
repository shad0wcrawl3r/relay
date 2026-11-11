package ai

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Local models can take many seconds to load into memory before the first
// reply. Preload starts that load when the user opens something that's about
// to ask the model (the ship log, an AI draft button), so the wait overlaps
// with them picking what to send. It sends no user content: Ollama is asked
// to load the model with an empty prompt, LM Studio gets a one-token
// completion of a fixed placeholder.

// preloadEvery: a model asked for again within this long is assumed still
// loaded, so repeat triggers don't send anything.
const preloadEvery = 4 * time.Minute

// preloadKeepAlive is how long Ollama keeps a preloaded model in memory.
const preloadKeepAlive = "10m"

var ErrNotPreloadable = errors.New("only Ollama and LM Studio on this machine can be preloaded")

type preloader struct {
	mu   sync.Mutex
	last map[string]time.Time
}

// Preloadable reports whether Relay can warm this provider's model: Ollama
// or LM Studio, at an address on this machine.
func (c *Client) Preloadable(id string) bool {
	return (id == "ollama" || id == "lmstudio") && c.Local(id)
}

// Preload loads model into memory and returns once it's loaded (or failed).
// A recent preload of the same model returns at once.
func (c *Client) Preload(ctx context.Context, id, model string) error {
	if model == "" {
		return ErrNoProvider
	}
	if !c.Preloadable(id) {
		return ErrNotPreloadable
	}
	key := id + "|" + c.Endpoint(id) + "|" + model
	c.pre.mu.Lock()
	if c.pre.last == nil {
		c.pre.last = map[string]time.Time{}
	}
	if t, ok := c.pre.last[key]; ok && time.Since(t) < preloadEvery {
		c.pre.mu.Unlock()
		return nil
	}
	c.pre.last[key] = time.Now()
	c.pre.mu.Unlock()

	start := time.Now()
	p, _ := Find(id)
	var err error
	if id == "ollama" {
		// Ollama's native API, beside /v1: an empty prompt only loads.
		err = c.requestAt(ctx, p, strings.TrimSuffix(c.Endpoint(id), "/v1")+"/api/generate",
			map[string]any{"model": model, "keep_alive": preloadKeepAlive, "stream": false})
	} else {
		err = c.requestAt(ctx, p, c.Endpoint(id)+"/chat/completions", map[string]any{
			"model": model, "max_tokens": 1,
			"messages": []map[string]string{{"role": "user", "content": "."}},
		})
	}
	if err != nil {
		// Let the next trigger try again.
		c.pre.mu.Lock()
		delete(c.pre.last, key)
		c.pre.mu.Unlock()
		log.Debug("preload failed", "provider", id, "model", model, "err", err)
		return err
	}
	log.Debug("model preloaded", "provider", id, "model", model, "ms", time.Since(start).Milliseconds())
	return nil
}

// requestAt posts body to a full URL on a local provider and discards the
// reply. Local providers take no key.
func (c *Client) requestAt(ctx context.Context, p Provider, target string, body any) error {
	var out map[string]any
	return c.requestURL(ctx, p, http.MethodPost, target, body, &out)
}
