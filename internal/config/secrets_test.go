package config

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

func resetSecrets(t *testing.T) {
	t.Helper()
	keyring.MockInit()
	t.Chdir(t.TempDir())
	t.Cleanup(func() {
		Override(func(c *Config) { c.DevTo.APIKey, c.Plane.ClientSecret = "", "" })
		stuck = map[string]bool{}
	})
}

func TestLoadSecretsMovesThemOutOfTheFile(t *testing.T) {
	resetSecrets(t)
	if err := os.WriteFile("config.toml", []byte("[devto]\nAPI_KEY = 'dev-key'\n[plane]\nCLIENT_SECRET = 'plane-secret'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	Override(func(c *Config) { c.DevTo.APIKey, c.Plane.ClientSecret = "dev-key", "plane-secret" })
	LoadSecrets()

	if got, _ := keyring.Get(keyringService, "devto-api-key"); got != "dev-key" {
		t.Errorf("keychain devto = %q", got)
	}
	if got, _ := keyring.Get(keyringService, "plane-client-secret"); got != "plane-secret" {
		t.Errorf("keychain plane = %q", got)
	}
	raw, _ := os.ReadFile("config.toml")
	if strings.Contains(string(raw), "dev-key") || strings.Contains(string(raw), "plane-secret") {
		t.Errorf("secrets left in the file:\n%s", raw)
	}
	if c := GetConfig(); c.DevTo.APIKey != "dev-key" || c.Plane.ClientSecret != "plane-secret" {
		t.Errorf("in memory = %q %q", c.DevTo.APIKey, c.Plane.ClientSecret)
	}
}

func TestUpdateSavesSecretsToTheKeychainOnly(t *testing.T) {
	resetSecrets(t)
	if err := os.WriteFile("config.toml", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Update(func(c *Config) { c.DevTo.APIKey = "new-key" }); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile("config.toml")
	if strings.Contains(string(raw), "new-key") {
		t.Errorf("secret written to the file:\n%s", raw)
	}
	if got, _ := keyring.Get(keyringService, "devto-api-key"); got != "new-key" {
		t.Errorf("keychain = %q", got)
	}
	if err := Update(func(c *Config) { c.DevTo.APIKey = "" }); err != nil {
		t.Fatal(err)
	}
	if _, err := keyring.Get(keyringService, "devto-api-key"); err != keyring.ErrNotFound {
		t.Errorf("cleared key still in the keychain: %v", err)
	}
}

func TestEnvSecretsStayOutOfKeychainAndFile(t *testing.T) {
	resetSecrets(t)
	t.Setenv("RELAY_DEVTO_API_KEY", "from-env")
	if err := os.WriteFile("config.toml", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	Override(func(c *Config) { c.DevTo.APIKey = "from-env" })
	LoadSecrets()
	if err := Update(func(c *Config) { c.Agent.Name = "x" }); err != nil {
		t.Fatal(err)
	}
	if _, err := keyring.Get(keyringService, "devto-api-key"); err != keyring.ErrNotFound {
		t.Error("env value copied into the keychain")
	}
	raw, _ := os.ReadFile("config.toml")
	if strings.Contains(string(raw), "from-env") {
		t.Errorf("env value written to the file:\n%s", raw)
	}
	if GetConfig().DevTo.APIKey != "from-env" {
		t.Error("env value lost")
	}
}

func TestSecretStaysInTheFileWhenTheKeychainFails(t *testing.T) {
	resetSecrets(t)
	keyring.MockInitWithError(errors.New("no keychain"))
	if err := os.WriteFile("config.toml", []byte("[devto]\nAPI_KEY = 'dev-key'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	Override(func(c *Config) { c.DevTo.APIKey = "dev-key" })
	LoadSecrets()
	if err := Update(func(c *Config) { c.Agent.Name = "y" }); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile("config.toml")
	if !strings.Contains(string(raw), "dev-key") {
		t.Errorf("secret lost when the keychain was unavailable:\n%s", raw)
	}
}
