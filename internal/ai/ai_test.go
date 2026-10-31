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

	"github.com/zalando/go-keyring"
)

func TestMain(m *testing.M) {
	keyring.MockInit()
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
	got, err := c.Complete(context.Background(), "anthropic", "m", "sys", "user")
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
	got, err := c.Complete(context.Background(), "openrouter", "m", "sys", "user")
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
	if _, err := c.Complete(context.Background(), "openai", "m", "s", "u"); err == nil || !strings.Contains(err.Error(), "API key") {
		t.Fatalf("err = %v", err)
	}
}

func TestErrorsAreFriendlyAndHideTheKey(t *testing.T) {
	_ = SetKey("openai", "sk-secret")
	for status, want := range map[int]string{401: "rejected", 429: "rate limit", 400: "model not found"} {
		c := clientFor(t, "openai", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			fmt.Fprint(w, `{"error":{"message":"model not found"}}`)
		})
		_, err := c.Complete(context.Background(), "openai", "m", "s", "u")
		if err == nil || !strings.Contains(err.Error(), want) || strings.Contains(err.Error(), "sk-secret") {
			t.Errorf("%d: err = %v", status, err)
		}
	}
}

func TestEmptyReplyIsAnError(t *testing.T) {
	c := clientFor(t, "ollama", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"choices":[]}`) })
	if _, err := c.Complete(context.Background(), "ollama", "m", "s", "u"); err == nil {
		t.Fatal("expected an error")
	}
}

func TestNoSelectionIsNoProvider(t *testing.T) {
	if _, err := New().Complete(context.Background(), "", "", "s", "u"); !errors.Is(err, ErrNoProvider) {
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
