package main

import (
	"os"
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/zalando/go-keyring"
)

func TestPrivateMarkFollowsTheEndpoint(t *testing.T) {
	keyring.MockInit()
	t.Chdir(t.TempDir())
	// Without ./config.toml, config.Update would write the real one.
	if err := os.WriteFile("config.toml", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	before := *config.GetConfig()
	t.Cleanup(func() { config.Override(func(c *config.Config) { *c = before }) })

	s := NewAIService(nil)
	trusted := func(id string) (marked, ok bool) {
		for _, p := range s.Status().Providers {
			if p.ID == id {
				return p.MarkedPrivate, p.Trusted
			}
		}
		t.Fatalf("no provider %s", id)
		return
	}
	if marked, ok := trusted("openai"); marked || ok {
		t.Fatal("cloud provider trusted by default")
	}
	if _, ok := trusted("ollama"); !ok {
		t.Fatal("local provider not trusted")
	}
	if _, err := s.SetPrivate("openai", true); err != nil {
		t.Fatal(err)
	}
	if marked, ok := trusted("openai"); !marked || !ok {
		t.Fatal("mark not saved")
	}
	if _, err := s.SetEndpoint("openai", "https://gateway.example.com/v1"); err != nil {
		t.Fatal(err)
	}
	if marked, _ := trusted("openai"); marked {
		t.Fatal("mark kept after the endpoint changed")
	}
	if _, err := s.SetPrivate("nope", true); err == nil {
		t.Fatal("unknown provider accepted")
	}
}
