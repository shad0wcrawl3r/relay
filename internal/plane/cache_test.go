package plane

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

func TestCacheSkipsPrivateProjects(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	if err := os.MkdirAll(config.AppDir(), 0o700); err != nil {
		t.Fatal(err)
	}
	snap := Snapshot{
		Connected: true, Workspace: "ws", SyncedAt: time.Now(),
		Projects: []Project{
			{ID: "w", Identifier: "WORK", Items: []Item{{ID: "i1", Name: "public"}}},
			{ID: "h", Identifier: "TEACH", Private: true, Items: []Item{{ID: "i2", Name: "secret"}}},
		},
	}
	if err := saveCache(snap); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(cachePath())
	if len(raw) == 0 || strings.Contains(string(raw), "TEACH") || strings.Contains(string(raw), "secret") {
		t.Fatalf("cache leaks private data or is empty: %s", raw)
	}
	got, ok := loadCache("ws")
	if !ok || !got.Cached || len(got.Projects) != 1 || got.Projects[0].Identifier != "WORK" {
		t.Errorf("loaded %+v ok=%v", got, ok)
	}
	if _, ok := loadCache("other-workspace"); ok {
		t.Error("cache served for a different workspace")
	}

	// Writes are refused while the cache is on screen.
	c := New()
	c.last = got
	if err := c.Update(context.Background(), "w", "i1", ItemPatch{}); err != ErrStale {
		t.Errorf("Update while stale = %v", err)
	}
	if err := clearCache(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cachePath()); !os.IsNotExist(err) {
		t.Error("cache not removed")
	}
}
