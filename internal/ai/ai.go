// Package ai sends prompts to the model provider the user connected. Requests
// run from Go, and API keys stay in the OS keychain.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/zalando/go-keyring"
)

const (
	keyringService = "relay"

	anthropicVersion = "2023-06-01"
	maxTokens        = 1024
)

// ErrNoProvider means no provider and model are selected.
var ErrNoProvider = errors.New("connect a model provider in Settings first")

// Provider is one service Relay can talk to. Local providers run on this
// machine, so nothing sent to them leaves it.
type Provider struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Local    bool   `json:"local"`
	NeedsKey bool   `json:"needsKey"`
}

var providers = []Provider{
	{ID: "anthropic", Name: "Anthropic", NeedsKey: true},
	{ID: "openai", Name: "OpenAI", NeedsKey: true},
	{ID: "openrouter", Name: "OpenRouter", NeedsKey: true},
	{ID: "ollama", Name: "Ollama", Local: true},
	{ID: "lmstudio", Name: "LM Studio", Local: true},
}

// Providers lists every supported provider.
func Providers() []Provider { return slices.Clone(providers) }

// Find returns the provider with the given ID.
func Find(id string) (Provider, bool) {
	i := slices.IndexFunc(providers, func(p Provider) bool { return p.ID == id })
	if i < 0 {
		return Provider{}, false
	}
	return providers[i], true
}

type Client struct {
	http *http.Client
	base map[string]string
}

func New() *Client {
	return &Client{
		// Local models can take minutes on a laptop.
		http: &http.Client{Timeout: 5 * time.Minute},
		base: map[string]string{
			"anthropic":  "https://api.anthropic.com/v1",
			"openai":     "https://api.openai.com/v1",
			"openrouter": "https://openrouter.ai/api/v1",
			"ollama":     "http://127.0.0.1:11434/v1",
			"lmstudio":   "http://127.0.0.1:1234/v1",
		},
	}
}

func keyName(id string) string { return "ai-" + id }

// HasKey reports whether a key is stored for the provider.
func HasKey(id string) bool {
	_, err := keyring.Get(keyringService, keyName(id))
	return err == nil
}

// SetKey stores a provider's API key in the keychain.
func SetKey(id, key string) error {
	if _, ok := Find(id); !ok {
		return fmt.Errorf("unknown provider %q", id)
	}
	return keyring.Set(keyringService, keyName(id), strings.TrimSpace(key))
}

// ClearKey removes a provider's API key.
func ClearKey(id string) error {
	err := keyring.Delete(keyringService, keyName(id))
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}

// request sends JSON and decodes the reply, turning provider errors into
// messages a user can act on. It never includes the key in an error.
func (c *Client) request(ctx context.Context, p Provider, method, path string, body, out any) error {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base[p.ID]+path, r)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.NeedsKey {
		key, err := keyring.Get(keyringService, keyName(p.ID))
		if err != nil {
			return fmt.Errorf("add your %s API key in Settings", p.Name)
		}
		if p.ID == "anthropic" {
			req.Header.Set("x-api-key", key)
			req.Header.Set("anthropic-version", anthropicVersion)
		} else {
			req.Header.Set("Authorization", "Bearer "+key)
		}
	}
	if p.ID == "openrouter" {
		req.Header.Set("HTTP-Referer", "https://relay.shadowcrawler.dev")
		req.Header.Set("X-Title", "Relay")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		if p.Local {
			return fmt.Errorf("couldn't reach %s. Is it running?", p.Name)
		}
		return fmt.Errorf("couldn't reach %s: %w", p.Name, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		return providerError(p, resp.StatusCode, data)
	}
	return json.Unmarshal(data, out)
}

func providerError(p Provider, status int, data []byte) error {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return fmt.Errorf("%s rejected the API key", p.Name)
	case http.StatusTooManyRequests:
		return fmt.Errorf("%s's rate limit was reached; try again shortly", p.Name)
	}
	var e struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(data, &e) == nil && e.Error.Message != "" {
		return fmt.Errorf("%s: %s", p.Name, e.Error.Message)
	}
	return fmt.Errorf("%s answered HTTP %d", p.Name, status)
}

// notChat matches OpenAI models that can't take a chat prompt.
var notChat = []string{"embedding", "whisper", "tts", "dall-e", "moderation", "sora", "transcribe", "audio", "realtime", "image"}

// Models lists the provider's models. Calling it also proves the key and
// connection work.
func (c *Client) Models(ctx context.Context, id string) ([]string, error) {
	p, ok := Find(id)
	if !ok {
		return nil, fmt.Errorf("unknown provider %q", id)
	}
	path := "/models"
	if id == "anthropic" {
		path = "/models?limit=100"
	}
	var out struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := c.request(ctx, p, http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	models := []string{}
	for _, m := range out.Data {
		if id == "openai" && slices.ContainsFunc(notChat, func(s string) bool { return strings.Contains(m.ID, s) }) {
			continue
		}
		models = append(models, m.ID)
	}
	return models, nil
}

// Complete returns the model's reply to one prompt.
func (c *Client) Complete(ctx context.Context, id, model, system, user string) (string, error) {
	p, ok := Find(id)
	if !ok || model == "" {
		return "", ErrNoProvider
	}
	var text string
	if id == "anthropic" {
		var out struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		}
		err := c.request(ctx, p, http.MethodPost, "/messages", map[string]any{
			"model":      model,
			"max_tokens": maxTokens,
			"system":     system,
			"messages":   []map[string]string{{"role": "user", "content": user}},
		}, &out)
		if err != nil {
			return "", err
		}
		for _, block := range out.Content {
			if block.Type == "text" {
				text += block.Text
			}
		}
	} else {
		var out struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		}
		err := c.request(ctx, p, http.MethodPost, "/chat/completions", map[string]any{
			"model": model,
			"messages": []map[string]string{
				{"role": "system", "content": system},
				{"role": "user", "content": user},
			},
		}, &out)
		if err != nil {
			return "", err
		}
		if len(out.Choices) > 0 {
			text = out.Choices[0].Message.Content
		}
	}
	if text = strings.TrimSpace(text); text == "" {
		return "", fmt.Errorf("%s returned an empty reply", p.Name)
	}
	return text, nil
}
