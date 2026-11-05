package ai

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/zalando/go-keyring"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// cloudClient talks to a cloud endpoint through a fake transport that counts
// the requests that would have left the machine.
func cloudClient(t *testing.T, sent *int) *Client {
	t.Helper()
	c := New()
	c.base["openai"] = "https://api.example.com/v1"
	c.http.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		*sent++
		body := `{"choices":[{"message":{"content":"draft"},"finish_reason":"stop"}]}`
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})
	if err := keyring.Set(keyringService, keyName("openai"), "sk-test"); err != nil {
		t.Fatal(err)
	}
	return c
}

func withPrivacy(t *testing.T, locked []string, private map[string]string) {
	t.Helper()
	before := *config.GetConfig()
	t.Cleanup(func() { config.Override(func(c *config.Config) { *c = before }) })
	config.Override(func(c *config.Config) {
		c.Privacy.Locked = locked
		c.AI.Private = private
		c.AI.Endpoints = nil
	})
}

func TestPrivateContentNeverReachesAnUntrustedProvider(t *testing.T) {
	withPrivacy(t, []string{"project:TEACH", "module:m1"}, nil)
	sent := 0
	c := cloudClient(t, &sent)
	for name, origin := range map[string]Origin{
		"locked project":       Plane("project:TEACH"),
		"locked module":        Plane("project:ENG", "module:m1"),
		"no keys, fail closed": Plane(),
	} {
		_, err := c.Complete(context.Background(), origin, "openai", "m", "s", "secret notes")
		if !IsPrivate(err) {
			t.Errorf("%s: err = %v, want a privacy refusal", name, err)
		}
		if err != nil && strings.Contains(err.Error(), "TEACH") {
			t.Errorf("%s: the refusal names the project: %v", name, err)
		}
	}
	if sent != 0 {
		t.Fatalf("%d requests left the machine", sent)
	}
	// Anything not private goes through.
	for _, origin := range []Origin{Local(), Plane("project:ENG", "module:m2")} {
		if _, err := c.Complete(context.Background(), origin, "openai", "m", "s", "u"); err != nil {
			t.Fatal(err)
		}
	}
	if sent != 2 {
		t.Fatalf("sent = %d, want 2", sent)
	}
}

func TestMarkedPrivateProviderMayReadPrivateContent(t *testing.T) {
	withPrivacy(t, []string{"project:TEACH"}, map[string]string{"openai": "https://api.example.com/v1"})
	sent := 0
	c := cloudClient(t, &sent)
	if !c.Trusted("openai") {
		t.Fatal("marked provider isn't trusted")
	}
	if _, err := c.Complete(context.Background(), Plane("project:TEACH"), "openai", "m", "s", "u"); err != nil {
		t.Fatal(err)
	}
	// Pointing the provider at another address drops the mark.
	config.Override(func(cfg *config.Config) {
		cfg.AI.Endpoints = map[string]string{"openai": "https://proxy.example.net/v1"}
	})
	if c.Trusted("openai") {
		t.Fatal("the mark survived an endpoint change")
	}
	if _, err := c.Complete(context.Background(), Plane("project:TEACH"), "openai", "m", "s", "u"); !IsPrivate(err) {
		t.Fatalf("err = %v, want a privacy refusal", err)
	}
	if sent != 1 {
		t.Fatalf("sent = %d, want 1", sent)
	}
}

func TestLocalProvidersAreTrusted(t *testing.T) {
	withPrivacy(t, []string{"project:TEACH"}, nil)
	c := New()
	if !c.Trusted("ollama") || !c.Trusted("lmstudio") {
		t.Fatal("local providers must be trusted")
	}
	// Ollama on another machine is a cloud provider like any other.
	config.Override(func(cfg *config.Config) {
		cfg.AI.Endpoints = map[string]string{"ollama": "http://192.168.1.20:11434/v1"}
	})
	if c.Trusted("ollama") {
		t.Fatal("remote Ollama trusted without a mark")
	}
}

func TestUnlockingDoesNotMakeContentPublic(t *testing.T) {
	// Privacy follows the lockable list; whether it's unlocked right now
	// isn't an input at all.
	withPrivacy(t, []string{"project:TEACH"}, nil)
	if !Plane("project:TEACH").Private() {
		t.Fatal("lockable project not private")
	}
	if Plane("project:ENG").Private() || Local().Private() {
		t.Fatal("public content marked private")
	}
}
