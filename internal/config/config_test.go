package config

import (
	"os"
	"testing"
	"time"
)

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
