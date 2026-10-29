package plane

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/vault"
	"github.com/zalando/go-keyring"
)

func TestCacheIsEncrypted(t *testing.T) {
	keyring.MockInit()
	vault.Reset()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	if err := os.MkdirAll(config.AppDir(), 0o700); err != nil {
		t.Fatal(err)
	}
	snap := Snapshot{
		Connected: true, Workspace: "ws", SyncedAt: time.Now(),
		Projects: []Project{
			{ID: "w", Identifier: "WORK", Items: []Item{{ID: "i1", Name: "public"}}},
			{ID: "h", Identifier: "TEACH", Items: []Item{{ID: "i2", Name: "secret"}}},
		},
	}
	if err := saveCache(snap); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(cachePath())
	if len(raw) == 0 || strings.Contains(string(raw), "TEACH") || strings.Contains(string(raw), "secret") || strings.Contains(string(raw), "public") {
		t.Fatalf("cache is not encrypted: %q", raw[:min(len(raw), 80)])
	}
	got, ok := loadCache("ws")
	if !ok || !got.Cached || len(got.Projects) != 2 {
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

	// A plaintext cache from an older version is discarded.
	os.WriteFile(cachePath(), []byte(`{"workspace":"ws"}`), 0o600)
	if _, ok := loadCache("ws"); ok {
		t.Error("plaintext cache accepted")
	}
	if _, err := os.Stat(cachePath()); !os.IsNotExist(err) {
		t.Error("plaintext cache not removed")
	}
}
