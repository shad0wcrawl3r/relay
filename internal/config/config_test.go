package config

import (
	"bytes"
	"os"
	"testing"
	"time"
)

func TestAIAndLogMapsSurviveAReload(t *testing.T) {
	t.Chdir(t.TempDir())
	if err := os.WriteFile("config.toml", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	err := Update(func(c *Config) {
		c.AI.Endpoints = map[string]string{"ollama": "http://10.0.0.2:11434/v1"}
		c.Logs.Enabled, c.Logs.Levels = true, map[string]string{"ai": "debug"}
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("config.toml")
	if err != nil {
		t.Fatal(err)
	}
	if err := v.ReadConfig(bytes.NewReader(raw)); err != nil {
		t.Fatal(err)
	}
	var reloaded Config
	if err := v.Unmarshal(&reloaded); err != nil {
		t.Fatal(err)
	}
	if reloaded.AI.Endpoints["ollama"] != "http://10.0.0.2:11434/v1" || !reloaded.Logs.Enabled || reloaded.Logs.Levels["ai"] != "debug" {
		t.Errorf("reloaded = %+v %+v", reloaded.AI, reloaded.Logs)
	}
}

// Update callbacks may read the config (e.g. via plane.AppURL); that used to
// deadlock because Update held the lock while running fn.
func TestUpdateCallbackCanReadConfig(t *testing.T) {
	// Path() prefers ./config.toml, so this keeps the write inside the temp dir.
	t.Chdir(t.TempDir())
	if err := os.WriteFile("config.toml", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		done <- Update(func(c *Config) {
			c.Agent.Name = GetConfig().Agent.Name + "!"
		})
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Update deadlocked")
	}
	if got := GetConfig().Agent.Name; got != "Claude Code!" {
		t.Errorf("Agent.Name = %q", got)
	}
}
