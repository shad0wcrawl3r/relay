package main

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/ai"
	"github.com/shad0wcrawl3r/relay/internal/backup"
	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/zalando/go-keyring"
)

// isolate points config and the keychain at throwaway copies.
func isolate(t *testing.T) {
	t.Helper()
	keyring.MockInit()
	t.Chdir(t.TempDir())
	// config.Path uses ./config.toml only when it exists; without it a test
	// would write the real one.
	if err := os.WriteFile("config.toml", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	before := *config.GetConfig()
	t.Cleanup(func() { config.Override(func(c *config.Config) { *c = before }) })
}

func TestExportPassphraseFollowsSettings(t *testing.T) {
	isolate(t)
	key, err := backupKey()
	if err != nil {
		t.Fatal(err)
	}
	words := func() string {
		b, err := currentBundle()
		if err != nil {
			t.Fatal(err)
		}
		payload, _ := json.Marshal(b)
		return backup.Passphrase(key, payload)
	}
	if err := config.Update(func(c *config.Config) { c.DevTo.APIKey = "dev-key" }); err != nil {
		t.Fatal(err)
	}
	first := words()
	if words() != first {
		t.Fatal("unchanged settings got new words")
	}
	// Finishing the guide is device state, not a settings change.
	_ = config.Update(func(c *config.Config) { c.Onboarding.Done = true })
	if words() != first {
		t.Fatal("onboarding changed the words")
	}
	_ = ai.SetKey("openai", "sk-test")
	if words() == first {
		t.Fatal("a new AI key kept the words")
	}
	if again, _ := backupKey(); string(again) != string(key) {
		t.Fatal("device key changed between exports")
	}
}

func TestImportRoundTrip(t *testing.T) {
	isolate(t)
	_ = config.Update(func(c *config.Config) {
		c.DevTo.APIKey = "dev-key"
		c.Plane.ClientID, c.Plane.ClientSecret = "client", "plane-secret"
		c.Terminal.Shell = "/no/such/shell"
		c.Privacy.Locked = []string{"project:A"}
	})
	_ = ai.SetKey("anthropic", "sk-ant")
	b, err := currentBundle()
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(b)
	sealed, err := backup.Seal(payload, "abacus zoom ladder pickle velvet orbit")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("x"+backupExt, sealed, 0o600); err != nil {
		t.Fatal(err)
	}

	// A fresh device: nothing set, one project locked, a working shell.
	keyring.MockInit()
	shell, _ := os.Executable()
	_ = config.Update(func(c *config.Config) {
		*c = config.Config{}
		c.Privacy.Locked = []string{"project:B"}
		c.Terminal.Shell = shell
		c.Onboarding.Done = true
	})

	s := &SettingsService{}
	if _, err := s.ImportSettings("x"+backupExt, "abacus zoom ladder pickle"); err == nil {
		t.Fatal("wrong passphrase imported")
	}
	if config.GetConfig().DevTo.APIKey != "" {
		t.Fatal("a failed import changed settings")
	}
	res, err := s.ImportSettings("x"+backupExt, "Abacus Zoom Ladder Pickle Velvet Orbit")
	if err != nil {
		t.Fatal(err)
	}
	c := config.GetConfig()
	if c.DevTo.APIKey != "dev-key" || c.Plane.ClientSecret != "plane-secret" || c.Plane.ClientID != "client" {
		t.Fatal("secrets not imported")
	}
	if got, _ := keyring.Get(config.KeyringService, "devto-api-key"); got != "dev-key" {
		t.Fatal("Dev.to key not in the keychain")
	}
	if k, _ := ai.Key("anthropic"); k != "sk-ant" {
		t.Fatal("AI key not imported")
	}
	if !slices.Contains(c.Privacy.Locked, "project:A") || !slices.Contains(c.Privacy.Locked, "project:B") {
		t.Fatalf("locks = %v, want both", c.Privacy.Locked)
	}
	if c.Terminal.Shell != shell || !res.ShellKept {
		t.Fatal("a missing shell replaced the working one")
	}
	if !c.Onboarding.Done {
		t.Fatal("import reset onboarding")
	}
	if !strings.Contains(strings.Join(res.Imported, ","), "Anthropic key") {
		t.Fatalf("imported = %v", res.Imported)
	}
	raw, _ := os.ReadFile("config.toml")
	if strings.Contains(string(raw), "dev-key") || strings.Contains(string(raw), "plane-secret") {
		t.Fatal("a secret reached config.toml")
	}
}
