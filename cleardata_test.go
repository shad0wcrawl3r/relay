package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/zalando/go-keyring"
)

func TestClearAllData(t *testing.T) {
	keyring.MockInit()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("APPDATA", filepath.Join(home, "AppData"))

	app := config.AppDir()
	if !filepath.IsAbs(app) || filepath.Base(app) != "relay" {
		t.Fatalf("unexpected app dir %q", app)
	}
	if err := os.MkdirAll(filepath.Join(app, "posts"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app, "plane-cache.json"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Someone else's file beside Relay's folder must survive.
	other := filepath.Join(filepath.Dir(app), "other-app")
	if err := os.MkdirAll(other, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range keychainAccounts() {
		if err := keyring.Set(config.KeyringService, name, "secret"); err != nil {
			t.Fatal(err)
		}
	}
	if err := keyring.Set(config.KeyringService, "not-relays", "keep"); err != nil {
		t.Fatal(err)
	}

	if err := clearAllData(false); err != nil {
		t.Fatalf("clearAllData: %v", err)
	}

	if _, err := os.Stat(app); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("app dir still there: %v", err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Errorf("another app's folder was touched: %v", err)
	}
	for _, name := range keychainAccounts() {
		if _, err := keyring.Get(config.KeyringService, name); !errors.Is(err, keyring.ErrNotFound) {
			t.Errorf("keychain entry %s still there (err %v)", name, err)
		}
	}
	if v, err := keyring.Get(config.KeyringService, "not-relays"); err != nil || v != "keep" {
		t.Errorf("unlisted keychain entry was removed: %q, %v", v, err)
	}
	// Clearing twice is fine.
	if err := clearAllData(false); err != nil {
		t.Errorf("second clear: %v", err)
	}
}

func TestRemoveDirRefusesOtherFolders(t *testing.T) {
	dir := t.TempDir()
	if err := removeDir(dir); err == nil {
		t.Fatal("removeDir deleted a folder not named for Relay")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("folder gone: %v", err)
	}
}

func TestClearDataCommandIgnoresOtherArgs(t *testing.T) {
	if clearDataCommand(nil) || clearDataCommand([]string{"--other"}) {
		t.Fatal("handled args without --clear-data")
	}
}
