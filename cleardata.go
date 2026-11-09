package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/ai"
	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/zalando/go-keyring"
)

// Clearing Relay's data: Settings → Storage → "Clear all data", and
// `relay --clear-data`, which the Windows uninstaller runs when asked to
// delete data too. Both remove the same things:
//
//   - every keychain entry Relay writes (vault key, backup key, sign-ins,
//     API keys), by name rather than everything under the "relay" service,
//     so another program's entries under that name survive;
//   - the app directory (config, encrypted caches, posts, layouts);
//   - the webview's own storage, where the OS keeps it under Relay's name.
//
// Exports saved to Downloads are the user's files and stay.

// bundleID is the macOS bundle identifier (build/config.yml), which names
// the WebKit storage folders.
const bundleID = "dev.shadowcrawler.relay"

const clearDataFlag = "--clear-data"

// keychainAccounts lists every keychain account Relay uses under
// config.KeyringService. Add new ones here.
func keychainAccounts() []string {
	names := []string{
		"data-key",            // internal/vault
		backupKeyUser,         // backupservice.go
		"buffer-oauth",        // internal/buffer
		"plane-oauth",         // internal/plane
		"devto-api-key",       // internal/config/secrets.go
		"plane-client-secret", // internal/config/secrets.go
	}
	for _, p := range ai.Providers() {
		names = append(names, "ai-"+p.ID) // internal/ai
	}
	return names
}

// webviewDirs lists the webview's storage folders, which hold only Relay's
// data.
func webviewDirs() []string {
	var dirs []string
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		if home != "" {
			lib := filepath.Join(home, "Library")
			dirs = append(dirs,
				filepath.Join(lib, "WebKit", bundleID),
				filepath.Join(lib, "Caches", bundleID),
				filepath.Join(lib, "HTTPStorages", bundleID),
				filepath.Join(lib, "Saved Application State", bundleID+".savedState"),
			)
		}
	case "windows":
		// WebView2's default user data folder: %APPDATA%\<exe name>.
		if appData := os.Getenv("APPDATA"); appData != "" {
			if exe, err := os.Executable(); err == nil {
				dirs = append(dirs, filepath.Join(appData, filepath.Base(exe)))
			}
		}
	}
	// Linux: WebKitGTK's folders are named after the program ("relay"),
	// a name other apps may share, so they're left alone. They hold only
	// the diff view's split/unified choice.
	return dirs
}

// clearAllData removes everything Relay stores. It carries on past
// failures and reports them all. While Relay is running the webview holds
// its folders open (WebView2 locks them), so running skips their errors:
// the helper from clearAfterQuit deletes them once Relay has exited.
func clearAllData(running bool) error {
	var errs []error
	for _, name := range keychainAccounts() {
		err := keyring.Delete(config.KeyringService, name)
		if err != nil && !errors.Is(err, keyring.ErrNotFound) {
			errs = append(errs, fmt.Errorf("keychain entry %s: %w", name, err))
		}
	}
	if err := removeDir(config.AppDir()); err != nil {
		errs = append(errs, err)
	}
	for _, dir := range webviewDirs() {
		if err := removeDir(dir); err != nil && !running {
			errs = append(errs, err)
		}
	}
	if runtime.GOOS == "darwin" && !testing.Testing() {
		// Window positions and other NSUserDefaults. cfprefsd caches them, so
		// ask it rather than deleting the plist. Absent defaults are fine.
		_ = exec.Command("defaults", "delete", bundleID).Run()
	}
	return errors.Join(errs...)
}

// removeDir deletes dir, refusing anything that isn't named for Relay so a
// bad environment can't point it at a home or system folder.
func removeDir(dir string) error {
	base := strings.ToLower(filepath.Base(dir))
	if !strings.Contains(base, "relay") {
		return fmt.Errorf("refusing to delete %s: not a Relay folder", dir)
	}
	if err := os.RemoveAll(dir); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("%s: %w", dir, err)
	}
	return nil
}

// clearDataCommand handles `relay --clear-data [pid]`: wait for that
// process (the app that asked) to exit, then clear everything. Returns false
// when the flag isn't present.
func clearDataCommand(args []string) bool {
	if len(args) == 0 || args[0] != clearDataFlag {
		return false
	}
	if len(args) > 1 {
		if pid, err := strconv.Atoi(args[1]); err == nil {
			waitForExit(pid, 30*time.Second)
		}
	}
	if err := clearAllData(false); err != nil {
		fmt.Fprintln(os.Stderr, "relay: some data couldn't be cleared:", err)
		os.Exit(1)
	}
	return true
}

// clearAfterQuit starts a copy of Relay that clears everything again once
// this process has exited, catching anything a background job or the
// webview wrote between the in-app clear and quitting.
func clearAfterQuit() {
	exe, err := os.Executable()
	if err != nil {
		logs.For("app").Warn("clear after quit: no executable path", "err", err)
		return
	}
	cmd := exec.Command(exe, clearDataFlag, strconv.Itoa(os.Getpid()))
	detach(cmd)
	if err := cmd.Start(); err != nil {
		logs.For("app").Warn("clear after quit: couldn't start", "err", err)
		return
	}
	_ = cmd.Process.Release()
}

// waitForExit polls until pid has exited or the timeout passes.
func waitForExit(pid int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for processAlive(pid) && time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
	}
}
