package plane

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/vault"
)

// The display cache lets Relay show the last synced board at launch instead
// of an empty window. It is encrypted with the keychain-held vault key, holds
// every project (locked ones are redacted before they reach the UI), and is
// read-only: writes are refused until a live sync replaces it.

func cachePath() string { return filepath.Join(config.AppDir(), "plane-cache.json") }

// saveCache encrypts and writes a successful snapshot.
func saveCache(snap Snapshot) error {
	if !snap.Connected || snap.Error != "" || snap.SyncedAt.IsZero() {
		return nil
	}
	b, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	return vault.WriteFile(cachePath(), b)
}

// loadCache returns the cached snapshot for workspace, if there is one.
func loadCache(workspace string) (Snapshot, bool) {
	b, err := vault.ReadFile(cachePath())
	if errors.Is(err, vault.ErrNotSealed) {
		// Plaintext from before encryption: drop it.
		_ = clearCache()
		return Snapshot{}, false
	}
	if err != nil {
		return Snapshot{}, false
	}
	var snap Snapshot
	if json.Unmarshal(b, &snap) != nil || snap.Workspace != workspace {
		return Snapshot{}, false
	}
	snap.Projects = orEmpty(snap.Projects)
	snap.Cached = true
	snap.Error = ""
	return snap, true
}

func clearCache() error {
	err := os.Remove(cachePath())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// LoadCache seeds Last() from the display cache when nothing has synced yet
// in this run.
func (c *Client) LoadCache() bool {
	if !c.Connected() {
		return false
	}
	snap, ok := loadCache(c.Workspace())
	if !ok {
		return false
	}
	snap.AppURL = AppURL()
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.last.SyncedAt.IsZero() && !c.last.Cached {
		return false
	}
	c.last = snap
	return true
}
