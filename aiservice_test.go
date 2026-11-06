package main

import (
	"os"
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/zalando/go-keyring"
)

func TestPrivateProviderSetting(t *testing.T) {
	keyring.MockInit()
	t.Chdir(t.TempDir())
	// Without ./config.toml, config.Update would write the real one.
	if err := os.WriteFile("config.toml", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	before := *config.GetConfig()
	t.Cleanup(func() { config.Override(func(c *config.Config) { *c = before }) })
	config.Override(func(c *config.Config) { c.AI.Private, c.AI.Endpoints = nil, nil })

	s := NewAIService(nil)
	private := func(id string) bool {
		for _, p := range s.Status().Providers {
			if p.ID == id {
				return p.Private
			}
		}
		t.Fatalf("no provider %s", id)
		return false
	}
	if private("openai") || !private("ollama") {
		t.Fatal("wrong defaults")
	}

	// Marking follows the endpoint.
	if _, err := s.SetPrivate("openai", true); err != nil {
		t.Fatal(err)
	}
	if !private("openai") {
		t.Fatal("mark not saved")
	}
	if _, err := s.SetEndpoint("openai", "https://gateway.example.com/v1"); err != nil {
		t.Fatal(err)
	}
	if private("openai") {
		t.Fatal("mark kept after the endpoint changed")
	}

	// Turning Ollama off sticks, even across an endpoint change and back.
	if _, err := s.SetPrivate("ollama", false); err != nil {
		t.Fatal(err)
	}
	_, _ = s.SetEndpoint("ollama", "http://192.168.1.20:11434/v1")
	_, _ = s.SetEndpoint("ollama", "")
	if private("ollama") {
		t.Fatal("turned-off Ollama came back on")
	}
	if _, err := s.SetPrivate("nope", true); err == nil {
		t.Fatal("unknown provider accepted")
	}
}
