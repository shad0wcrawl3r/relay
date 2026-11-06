package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/zalando/go-keyring"
)

func TestMain(m *testing.M) {
	keyring.MockInit()
	// Ignore the developer's own AI settings: a custom endpoint in their
	// config.toml would send these tests to a real server.
	config.Override(func(c *config.Config) {
		c.AI.Endpoints, c.AI.Provider, c.AI.Model = nil, "", ""
	})
	os.Exit(m.Run())
}

func clientFor(t *testing.T, id string, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c := New()
	c.base[id] = srv.URL
	return c
}

func TestAnthropicRequest(t *testing.T) {
	if err := SetKey("anthropic", " sk-test "); err != nil {
		t.Fatal(err)
	}
	c := clientFor(t, "anthropic", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/messages" || r.Header.Get("x-api-key") != "sk-test" || r.Header.Get("anthropic-version") == "" {
			t.Errorf("request = %s %v", r.URL.Path, r.Header)
		}
		if r.Header.Get("Authorization") != "" {
			t.Error("Anthropic takes x-api-key, not a bearer token")
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["system"] != "sys" || body["model"] != "m" || body["max_tokens"] == nil {
			t.Errorf("body = %v", body)
		}
		fmt.Fprint(w, `{"content":[{"type":"text","text":" hello "},{"type":"thinking"}]}`)
	})
	got, err := c.Complete(context.Background(), Local(), "anthropic", "m", "sys", "user")
	if err != nil || got != "hello" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestOpenAICompatibleRequest(t *testing.T) {
	if err := SetKey("openrouter", "or-key"); err != nil {
		t.Fatal(err)
	}
	c := clientFor(t, "openrouter", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer or-key" {
			t.Errorf("request = %s %v", r.URL.Path, r.Header)
		}
		var body struct {
			Messages []map[string]string `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if len(body.Messages) != 2 || body.Messages[0]["role"] != "system" || body.Messages[1]["content"] != "user" {
			t.Errorf("messages = %v", body.Messages)
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"hi"}}]}`)
	})
	got, err := c.Complete(context.Background(), Local(), "openrouter", "m", "sys", "user")
	if err != nil || got != "hi" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestLocalProviderNeedsNoKey(t *testing.T) {
	c := clientFor(t, "ollama", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("sent a key to a local provider")
		}
		fmt.Fprint(w, `{"data":[{"id":"llama3"}]}`)
	})
	got, err := c.Models(context.Background(), "ollama")
	if err != nil || !reflect.DeepEqual(got, []string{"llama3"}) {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestLocalProviderDownSaysSo(t *testing.T) {
	c := New()
	c.base["lmstudio"] = "http://127.0.0.1:1"
	_, err := c.Models(context.Background(), "lmstudio")
	if err == nil || !strings.Contains(err.Error(), "running") {
		t.Fatalf("err = %v", err)
	}
}

func TestOpenAIModelsDropNonChat(t *testing.T) {
	_ = SetKey("openai", "k")
	c := clientFor(t, "openai", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"data":[{"id":"gpt-x"},{"id":"text-embedding-3"},{"id":"whisper-1"}]}`)
	})
	got, err := c.Models(context.Background(), "openai")
	if err != nil || !reflect.DeepEqual(got, []string{"gpt-x"}) {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestMissingKeyAsksForIt(t *testing.T) {
	_ = ClearKey("openai")
	c := clientFor(t, "openai", func(http.ResponseWriter, *http.Request) { t.Error("no request expected") })
	if _, err := c.Complete(context.Background(), Local(), "openai", "m", "s", "u"); err == nil || !strings.Contains(err.Error(), "API key") {
		t.Fatalf("err = %v", err)
	}
}

func TestErrorsAreFriendlyAndHideTheKey(t *testing.T) {
	_ = SetKey("openai", "sk-secret")
	for status, want := range map[int]string{401: "rejected", 429: "rate limited", 400: "model not found"} {
		c := clientFor(t, "openai", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			fmt.Fprint(w, `{"error":{"message":"model not found"}}`)
		})
		_, err := c.Complete(context.Background(), Local(), "openai", "m", "s", "u")
		if err == nil || !strings.Contains(err.Error(), want) || strings.Contains(err.Error(), "sk-secret") {
			t.Errorf("%d: err = %v", status, err)
		}
	}
}

func TestEmptyReplyIsAnError(t *testing.T) {
	c := clientFor(t, "ollama", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"choices":[]}`) })
	if _, err := c.Complete(context.Background(), Local(), "ollama", "m", "s", "u"); err == nil {
		t.Fatal("expected an error")
	}
}

func TestRateLimitShowsTheUpstreamReason(t *testing.T) {
	_ = SetKey("openrouter", "k")
	c := clientFor(t, "openrouter", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "20")
		w.WriteHeader(http.StatusTooManyRequests)
		fmt.Fprint(w, `{"error":{"message":"Provider returned error","metadata":{"raw":"free model is rate-limited upstream"}}}`)
	})
	_, err := c.Complete(context.Background(), Local(), "openrouter", "m", "s", "u")
	if err == nil || !strings.Contains(err.Error(), "rate-limited upstream") || !strings.Contains(err.Error(), "20s") {
		t.Fatalf("err = %v", err)
	}
}

func TestErrorsInsideSuccessfulResponses(t *testing.T) {
	_ = SetKey("openrouter", "k")
	for name, body := range map[string]string{
		"top level": `{"error":{"message":"upstream failed"}}`,
		"in choice": `{"choices":[{"error":{"message":"upstream failed"},"finish_reason":"error"}]}`,
	} {
		c := clientFor(t, "openrouter", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) })
		_, err := c.Complete(context.Background(), Local(), "openrouter", "m", "s", "u")
		if err == nil || !strings.Contains(err.Error(), "upstream failed") {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestEmptyReplySaysWhy(t *testing.T) {
	_ = SetKey("openrouter", "k")
	c := clientFor(t, "openrouter", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"choices":[{"message":{"content":null,"reasoning":"thinking hard"},"finish_reason":"length"}]}`)
	})
	_, err := c.Complete(context.Background(), Local(), "openrouter", "m", "s", "u")
	if err == nil || !strings.Contains(err.Error(), "length") || !strings.Contains(err.Error(), "reasoning") {
		t.Fatalf("err = %v", err)
	}
}

func TestContentCanBeAListOfParts(t *testing.T) {
	c := clientFor(t, "ollama", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"choices":[{"message":{"content":[{"type":"text","text":"he"},{"type":"text","text":"llo"}]}}]}`)
	})
	if got, err := c.Complete(context.Background(), Local(), "ollama", "m", "s", "u"); err != nil || got != "hello" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestCustomEndpointReplacesTheDefault(t *testing.T) {
	_ = SetKey("openai", "custom-key")
	used := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		used = r.URL.Path == "/proxy/v1/models" && r.Header.Get("Authorization") == "Bearer custom-key"
		fmt.Fprint(w, `{"data":[{"id":"gpt-x"}]}`)
	}))
	defer srv.Close()
	config.Override(func(c *config.Config) { c.AI.Endpoints = map[string]string{"openai": srv.URL + "/proxy/v1"} })
	t.Cleanup(func() { config.Override(func(c *config.Config) { c.AI.Endpoints = nil }) })
	if _, err := New().Models(context.Background(), "openai"); err != nil || !used {
		t.Fatalf("used = %v, err = %v", used, err)
	}
}

func TestStoredKeyIsSentToKeylessProviders(t *testing.T) {
	_ = SetKey("lmstudio", "proxy-key")
	t.Cleanup(func() { _ = ClearKey("lmstudio") })
	c := clientFor(t, "lmstudio", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer proxy-key" {
			t.Errorf("auth = %q", r.Header.Get("Authorization"))
		}
		fmt.Fprint(w, `{"data":[]}`)
	})
	if _, err := c.Models(context.Background(), "lmstudio"); err != nil {
		t.Fatal(err)
	}
}

func TestLocalFollowsTheEndpoint(t *testing.T) {
	t.Cleanup(func() { config.Override(func(c *config.Config) { c.AI.Endpoints = nil }) })
	c := New()
	for endpoint, want := range map[string]bool{
		"":                             true,
		"http://localhost:11434/v1":    true,
		"http://127.0.0.1:9000/v1":     true,
		"http://[::1]:9000/v1":         true,
		"http://192.168.1.20:11434":    false,
		"https://ollama.example.com":   false,
		"http://localhost.example.com": false,
	} {
		config.Override(func(cfg *config.Config) { cfg.AI.Endpoints = map[string]string{"ollama": endpoint} })
		if got := c.Local("ollama"); got != want {
			t.Errorf("%q: local = %v", endpoint, got)
		}
	}
	config.Override(func(cfg *config.Config) { cfg.AI.Endpoints = map[string]string{"anthropic": "http://127.0.0.1:8000"} })
	if !c.Local("anthropic") {
		t.Error("a loopback proxy is local")
	}
}

func TestNormaliseEndpoint(t *testing.T) {
	for raw, want := range map[string]string{" https://x.io/v1/ ": "https://x.io/v1", "": "", "http://10.0.0.2:1234/v1": "http://10.0.0.2:1234/v1"} {
		if got, err := NormaliseEndpoint(raw); err != nil || got != want {
			t.Errorf("%q: got %q, %v", raw, got, err)
		}
	}
	for _, bad := range []string{"x.io/v1", "ftp://x.io", "https://", "file:///etc/passwd"} {
		if _, err := NormaliseEndpoint(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestNoSelectionIsNoProvider(t *testing.T) {
	if _, err := New().Complete(context.Background(), Local(), "", "", "s", "u"); !errors.Is(err, ErrNoProvider) {
		t.Fatalf("err = %v", err)
	}
}

func TestLinkedInPrompt(t *testing.T) {
	_, user := LinkedInPrompt(Article{
		Title: "T", Series: "Go Notes", Tags: []string{"go"}, Description: "D",
		Body: "Intro <INSERT IMAGE HERE: diagram> outro",
	})
	for _, want := range []string{"Title: T", "Series: Go Notes", "Tags: go", "Description: D", "<article>", "Intro  outro"} {
		if !strings.Contains(user, want) {
			t.Errorf("missing %q in %q", want, user)
		}
	}
	if strings.Contains(user, "INSERT IMAGE") {
		t.Error("placeholder reached the model")
	}
	_, long := LinkedInPrompt(Article{Title: "T", Body: strings.Repeat("é", maxArticleChars+10)})
	if strings.Count(long, "é") != maxArticleChars {
		t.Errorf("not truncated by characters: %d", strings.Count(long, "é"))
	}
	if _, plain := LinkedInPrompt(Article{Title: "T"}); strings.Contains(plain, "Series:") {
		t.Error("empty series included")
	}
}
