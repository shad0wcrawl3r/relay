package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"sync/atomic"
	"testing"
)

func TestPreloadOllamaLoadsWithoutAPrompt(t *testing.T) {
	var calls atomic.Int32
	c := clientFor(t, "ollama", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/api/generate" {
			t.Errorf("path %s, want Ollama's native /api/generate", r.URL.Path)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, ok := body["prompt"]; ok {
			t.Errorf("preload sent a prompt: %v", body)
		}
		if body["model"] != "llama3" || body["keep_alive"] == nil {
			t.Errorf("body %v", body)
		}
		_, _ = w.Write([]byte(`{"done":true}`))
	})
	c.base["ollama"] += "/v1"
	for range 3 {
		if err := c.Preload(context.Background(), "ollama", "llama3"); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Errorf("%d requests; repeat preloads should be skipped", calls.Load())
	}
}

func TestPreloadOnlyLocalProviders(t *testing.T) {
	c := New()
	if c.Preloadable("openai") || c.Preloadable("anthropic") {
		t.Error("cloud providers aren't preloadable")
	}
	c.base["ollama"] = "http://192.168.1.10:11434/v1"
	if c.Preloadable("ollama") {
		t.Error("Ollama on another machine isn't preloadable")
	}
	if err := c.Preload(context.Background(), "openai", "gpt"); err != ErrNotPreloadable {
		t.Errorf("err %v", err)
	}
}

func TestPreloadRetriesAfterFailure(t *testing.T) {
	var calls atomic.Int32
	c := clientFor(t, "lmstudio", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, `{"error":{"message":"no model"}}`, http.StatusBadRequest)
	})
	for range 2 {
		if err := c.Preload(context.Background(), "lmstudio", "qwen"); err == nil {
			t.Fatal("want an error")
		}
	}
	if calls.Load() != 2 {
		t.Errorf("%d requests; a failed preload should be retried", calls.Load())
	}
}
