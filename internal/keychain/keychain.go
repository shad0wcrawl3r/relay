// Package keychain stores Relay's secrets (the vault key, sign-ins, API
// keys) in the OS keychain through go-keyring.
//
// Linux without a Secret Service (WSL, minimal window managers, headless
// boxes) has no keychain at all. There, and only there, secrets go to a
// plain file instead: $XDG_DATA_HOME/relay/secrets.json (by default
// ~/.local/share/relay/secrets.json), readable by the user alone. It isn't
// encrypted: whoever can read it has every Relay sign-in and the key to the
// vault. Settings → Storage says so while it's in use.
//
// The file is used only when the keychain can't be reached, not when it
// refuses (a dismissed unlock prompt stays an error). A secret found in the
// file once a keychain appears is moved into the keychain.
package keychain

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"

	"github.com/godbus/dbus/v5"
	"github.com/zalando/go-keyring"
)

// ErrNotFound is returned when there is no such secret.
var ErrNotFound = keyring.ErrNotFound

// The OS keychain, swapped out in tests.
var (
	osGet    = keyring.Get
	osSet    = keyring.Set
	osDelete = keyring.Delete
	linux    = runtime.GOOS == "linux"
)

var (
	mu       sync.Mutex
	fellBack bool // the keychain was unreachable at least once
)

// Get returns the secret for service and user.
func Get(service, user string) (string, error) {
	v, err := osGet(service, user)
	if !linux || (err != nil && !errors.Is(err, ErrNotFound) && !unavailable(err)) {
		return v, err
	}
	if err == nil {
		return v, nil
	}
	mu.Lock()
	defer mu.Unlock()
	if unavailable(err) {
		fellBack = true
	}
	secrets, ferr := readFile()
	if ferr != nil {
		return "", ferr
	}
	v, ok := secrets[key(service, user)]
	if !ok {
		return "", ErrNotFound
	}
	if !unavailable(err) {
		// A keychain has appeared since this was saved: move it there.
		if osSet(service, user, v) == nil {
			delete(secrets, key(service, user))
			_ = writeFile(secrets)
		}
	}
	return v, nil
}

// Set stores the secret for service and user.
func Set(service, user, value string) error {
	err := osSet(service, user, value)
	if !linux || !unavailable(err) {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	fellBack = true
	secrets, ferr := readFile()
	if ferr != nil {
		return ferr
	}
	secrets[key(service, user)] = value
	return writeFile(secrets)
}

// Delete removes the secret for service and user from the keychain and the
// file. ErrNotFound when neither had it.
func Delete(service, user string) error {
	err := osDelete(service, user)
	if !linux || (err != nil && !errors.Is(err, ErrNotFound) && !unavailable(err)) {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	if unavailable(err) {
		fellBack = true
	}
	secrets, ferr := readFile()
	if ferr != nil {
		return ferr
	}
	if _, ok := secrets[key(service, user)]; !ok {
		if err == nil {
			return nil
		}
		return ErrNotFound
	}
	delete(secrets, key(service, user))
	return writeFile(secrets)
}

// Fallback reports whether secrets are going to the plain file: the
// keychain was unreachable, or the file holds secrets. It returns the
// file's path too.
func Fallback() (bool, string) {
	if !linux {
		return false, ""
	}
	mu.Lock()
	defer mu.Unlock()
	if fellBack {
		return true, Path()
	}
	secrets, err := readFile()
	return err == nil && len(secrets) > 0, Path()
}

// Path is the fallback file.
func Path() string {
	return filepath.Join(DataDir(), "secrets.json")
}

// DataDir is $XDG_DATA_HOME/relay, by default ~/.local/share/relay.
func DataDir() string {
	base := os.Getenv("XDG_DATA_HOME")
	if !filepath.IsAbs(base) {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".local", "share")
	}
	return filepath.Join(base, "relay")
}

// unavailable reports whether err means there is no keychain to talk to,
// rather than one that said no: no session bus, or nothing on it providing
// org.freedesktop.secrets.
func unavailable(err error) bool {
	if err == nil || errors.Is(err, ErrNotFound) {
		return false
	}
	var dbusErr dbus.Error
	if errors.As(err, &dbusErr) {
		switch dbusErr.Name {
		case "org.freedesktop.DBus.Error.ServiceUnknown",
			"org.freedesktop.DBus.Error.NameHasNoOwner",
			"org.freedesktop.DBus.Error.Spawn.ExecFailed",
			"org.freedesktop.DBus.Error.Spawn.ChildExited":
			return true
		}
	}
	if errors.Is(err, syscall.ENOENT) || errors.Is(err, syscall.ECONNREFUSED) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "couldn't determine address of session bus") ||
		strings.Contains(msg, "org.freedesktop.secrets was not provided")
}

func key(service, user string) string { return service + "/" + user }

// readFile loads the fallback file; a missing one is empty.
func readFile() (map[string]string, error) {
	raw, err := os.ReadFile(Path())
	if errors.Is(err, fs.ErrNotExist) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", Path(), err)
	}
	secrets := map[string]string{}
	if err := json.Unmarshal(raw, &secrets); err != nil {
		return nil, fmt.Errorf("read %s: %w", Path(), err)
	}
	return secrets, nil
}

// writeFile replaces the fallback file, readable by the user alone. An
// empty set removes it.
func writeFile(secrets map[string]string) error {
	if len(secrets) == 0 {
		if err := os.Remove(Path()); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(DataDir(), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(secrets, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(DataDir(), ".secrets-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), Path())
}

// RemoveFile deletes the fallback file and, if then empty, its folder.
// Used by "Clear all data".
func RemoveFile() error {
	if !linux {
		return nil
	}
	mu.Lock()
	defer mu.Unlock()
	if err := os.Remove(Path()); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	_ = os.Remove(DataDir()) // only if empty
	return nil
}
