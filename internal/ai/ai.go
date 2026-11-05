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
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/zalando/go-keyring"
)

const (
	keyringService = "relay"

	anthropicVersion = "2023-06-01"
	maxTokens        = 1024
)

var log = logs.For("ai")

// ErrNoProvider means no provider and model are selected.
var ErrNoProvider = errors.New("connect a model provider in Settings first")

// Provider is one service Relay can talk to. NeedsKey means it can't work
// without one; any stored key is sent regardless, for keyed custom endpoints.
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
		http: &http.Client{Timeout: 5 * time.Minute, Transport: logs.Transport("ai", nil)},
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

// Default returns the provider's built-in base URL.
func (c *Client) Default(id string) string { return c.base[id] }

// Endpoint returns the provider's base URL, honouring a custom one.
func (c *Client) Endpoint(id string) string {
	if custom := config.GetConfig().AI.Endpoints[id]; custom != "" {
		return custom
	}
	return c.base[id]
}

// Local reports whether the provider's endpoint is on this machine. It looks
// at the address, not the provider: Ollama on another host isn't local, and
// neither is anything else that sends data off the machine.
func (c *Client) Local(id string) bool {
	u, err := url.Parse(c.Endpoint(id))
	if err != nil {
		return false
	}
	host := u.Hostname()
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return host == "localhost"
}

// NormaliseEndpoint validates a custom base URL. Empty means use the default.
func NormaliseEndpoint(raw string) (string, error) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", errors.New("use a full URL, like https://example.com/v1")
	}
	return raw, nil
}

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
	req, err := http.NewRequestWithContext(ctx, method, c.Endpoint(p.ID)+path, r)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	key, err := keyring.Get(keyringService, keyName(p.ID))
	if err != nil && p.NeedsKey {
		return fmt.Errorf("add your %s API key in Settings", p.Name)
	}
	if key != "" {
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
		if c.Local(p.ID) {
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
		return providerError(p, resp, data)
	}
	return json.Unmarshal(data, out)
}

// apiError is the error object OpenAI-style APIs and Anthropic share.
// OpenRouter puts the upstream provider's own message in metadata.raw.
type apiError struct {
	Message  string `json:"message"`
	Metadata struct {
		Raw          string `json:"raw"`
		ProviderName string `json:"provider_name"`
	} `json:"metadata"`
}

// detail prefers the upstream provider's message, which says what went wrong.
func (e *apiError) detail() string {
	if e == nil {
		return ""
	}
	if e.Metadata.Raw != "" {
		return e.Metadata.Raw
	}
	return e.Message
}

func providerError(p Provider, resp *http.Response, data []byte) error {
	var body struct {
		Error *apiError `json:"error"`
	}
	_ = json.Unmarshal(data, &body)
	detail := body.Error.detail()
	log.Warn("provider refused the request", "provider", p.ID, "status", resp.StatusCode, "detail", detail)
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return fmt.Errorf("%s rejected the API key", p.Name)
	case http.StatusTooManyRequests:
		msg := fmt.Sprintf("%s rate limited this request", p.Name)
		if detail != "" {
			msg += ": " + detail
		}
		if retry := resp.Header.Get("Retry-After"); retry != "" {
			msg += fmt.Sprintf(" (try again in %ss)", retry)
		}
		return errors.New(msg)
	}
	if detail != "" {
		return fmt.Errorf("%s: %s", p.Name, detail)
	}
	return fmt.Errorf("%s answered HTTP %d", p.Name, resp.StatusCode)
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

// reply is what a model sent back, in any provider's shape.
type reply struct {
	text, reason, upstream string
	reasoningChars         int
	inputTokens            int
	outputTokens           int
}

func (c *Client) anthropic(ctx context.Context, p Provider, model, system, user string) (reply, error) {
	var out struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
		Usage      struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	err := c.request(ctx, p, http.MethodPost, "/messages", map[string]any{
		"model":      model,
		"max_tokens": maxTokens,
		"system":     system,
		"messages":   []map[string]string{{"role": "user", "content": user}},
	}, &out)
	if err != nil {
		return reply{}, err
	}
	r := reply{reason: out.StopReason, inputTokens: out.Usage.InputTokens, outputTokens: out.Usage.OutputTokens}
	for _, block := range out.Content {
		if block.Type == "text" {
			r.text += block.Text
		}
	}
	return r, nil
}

// contentText reads a message's content, which is a string or a list of parts.
func contentText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var parts []struct {
		Text string `json:"text"`
	}
	_ = json.Unmarshal(raw, &parts)
	var b strings.Builder
	for _, part := range parts {
		b.WriteString(part.Text)
	}
	return b.String()
}

// openAICompatible also covers errors sent with HTTP 200, which OpenRouter does
// when the upstream provider fails after the response has started.
func (c *Client) openAICompatible(ctx context.Context, p Provider, model, system, user string) (reply, error) {
	var out struct {
		Provider string    `json:"provider"`
		Error    *apiError `json:"error"`
		Choices  []struct {
			Message struct {
				Content   json.RawMessage `json:"content"`
				Reasoning string          `json:"reasoning"`
			} `json:"message"`
			FinishReason string    `json:"finish_reason"`
			Error        *apiError `json:"error"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	err := c.request(ctx, p, http.MethodPost, "/chat/completions", map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		},
	}, &out)
	if err != nil {
		return reply{}, err
	}
	failure := out.Error
	r := reply{upstream: out.Provider, inputTokens: out.Usage.PromptTokens, outputTokens: out.Usage.CompletionTokens}
	if len(out.Choices) > 0 {
		choice := out.Choices[0]
		if failure == nil {
			failure = choice.Error
		}
		r.text, r.reason = contentText(choice.Message.Content), choice.FinishReason
		r.reasoningChars = len(choice.Message.Reasoning)
	}
	if failure != nil {
		log.Warn("provider reported an error in a successful response", "provider", p.ID, "model", model, "upstream", r.upstream, "detail", failure.detail())
		return reply{}, fmt.Errorf("%s: %s", p.Name, failure.detail())
	}
	return r, nil
}

// Complete returns the model's reply to one prompt. origin says where the
// prompt's content came from; private content only goes to a trusted
// provider (privacy.go). Logs carry sizes and reasons only, never the prompt
// or reply.
func (c *Client) Complete(ctx context.Context, origin Origin, id, model, system, user string) (string, error) {
	p, ok := Find(id)
	if !ok || model == "" {
		return "", ErrNoProvider
	}
	if err := c.allow(p, origin); err != nil {
		return "", err
	}
	start := time.Now()
	log.Info("completion started", "provider", id, "model", model, "input_chars", len(user))
	complete := c.openAICompatible
	if id == "anthropic" {
		complete = c.anthropic
	}
	r, err := complete(ctx, p, model, system, user)
	if err != nil {
		return "", err
	}
	r.text = strings.TrimSpace(r.text)
	fields := []any{
		"provider", id, "model", model, "upstream", r.upstream, "finish_reason", r.reason,
		"input_tokens", r.inputTokens, "output_tokens", r.outputTokens,
		"reply_chars", len(r.text), "reasoning_chars", r.reasoningChars,
		"ms", time.Since(start).Milliseconds(),
	}
	if r.text == "" {
		log.Warn("empty reply", fields...)
		return "", emptyReply(p, r)
	}
	log.Info("completion finished", fields...)
	return r.text, nil
}

func emptyReply(p Provider, r reply) error {
	msg := fmt.Sprintf("%s returned an empty reply", p.Name)
	if r.reason != "" {
		msg += fmt.Sprintf(" (finish reason: %s)", r.reason)
	}
	if r.reasoningChars > 0 {
		msg += ". The model used its whole reply on reasoning"
	}
	return errors.New(msg + ". Try again or pick another model")
}
