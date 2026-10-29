package plane

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

// The display cache lets Relay show the last synced board at launch instead
// of an empty window. It is read-only: the frontend blocks edits until a live
// sync replaces it. Private projects (Teaching) are never written.

func cachePath() string { return filepath.Join(config.AppDir(), "plane-cache.json") }

// saveCache writes a successful snapshot, minus private projects.
func saveCache(snap Snapshot) error {
	if !snap.Connected || snap.Error != "" || snap.SyncedAt.IsZero() {
		return nil
	}
	pub := make([]Project, 0, len(snap.Projects))
	for _, p := range snap.Projects {
		if !p.Private && !PrivateProjects[p.Identifier] {
			pub = append(pub, p)
		}
	}
	snap.Projects = pub
	b, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(config.AppDir(), 0o700); err != nil {
		return err
	}
	tmp := cachePath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, cachePath())
}

// loadCache returns the cached snapshot for workspace, if there is one.
func loadCache(workspace string) (Snapshot, bool) {
	b, err := os.ReadFile(cachePath())
	if err != nil {
		return Snapshot{}, false
	}
	var snap Snapshot
	if json.Unmarshal(b, &snap) != nil || snap.Workspace != workspace {
		return Snapshot{}, false
	}
	// Belt and braces: never surface a private project from disk.
	pub := snap.Projects[:0]
	for _, p := range snap.Projects {
		if !p.Private && !PrivateProjects[p.Identifier] {
			pub = append(pub, p)
		}
	}
	snap.Projects = orEmpty(pub)
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
