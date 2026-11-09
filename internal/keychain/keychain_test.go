package keychain

import (
	"errors"
	"os"
	"testing"

	"github.com/godbus/dbus/v5"
)

// fake replaces the OS keychain with a map, or with one that is unreachable.
type fake struct {
	store map[string]string
	down  bool
}

var noService = dbus.Error{
	Name: "org.freedesktop.DBus.Error.ServiceUnknown",
	Body: []any{"The name org.freedesktop.secrets was not provided by any .service files"},
}

func install(t *testing.T, f *fake) {
	t.Helper()
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	oldGet, oldSet, oldDel, oldLinux := osGet, osSet, osDelete, linux
	t.Cleanup(func() {
		osGet, osSet, osDelete, linux = oldGet, oldSet, oldDel, oldLinux
		fellBack = false
	})
	linux = true
	fellBack = false
	osGet = func(s, u string) (string, error) {
		if f.down {
			return "", noService
		}
		v, ok := f.store[s+"/"+u]
		if !ok {
			return "", ErrNotFound
		}
		return v, nil
	}
	osSet = func(s, u, v string) error {
		if f.down {
			return noService
		}
		f.store[s+"/"+u] = v
		return nil
	}
	osDelete = func(s, u string) error {
		if f.down {
			return noService
		}
		if _, ok := f.store[s+"/"+u]; !ok {
			return ErrNotFound
		}
		delete(f.store, s+"/"+u)
		return nil
	}
}

func TestNoKeychainUsesFile(t *testing.T) {
	f := &fake{store: map[string]string{}, down: true}
	install(t, f)

	if _, err := Get("relay", "buffer-oauth"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get before Set: %v, want ErrNotFound", err)
	}
	if err := Set("relay", "buffer-oauth", "token"); err != nil {
		t.Fatal(err)
	}
	if v, err := Get("relay", "buffer-oauth"); err != nil || v != "token" {
		t.Fatalf("Get = %q, %v", v, err)
	}
	info, err := os.Stat(Path())
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("file mode %o, want 600", perm)
	}
	if on, path := Fallback(); !on || path != Path() {
		t.Fatalf("Fallback = %v, %q", on, path)
	}
	if err := Delete("relay", "buffer-oauth"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(Path()); !os.IsNotExist(err) {
		t.Fatalf("file left after the last secret was deleted: %v", err)
	}
	if err := Delete("relay", "buffer-oauth"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second Delete: %v, want ErrNotFound", err)
	}
}

func TestKeychainPreferred(t *testing.T) {
	f := &fake{store: map[string]string{}}
	install(t, f)
	if err := Set("relay", "data-key", "k"); err != nil {
		t.Fatal(err)
	}
	if f.store["relay/data-key"] != "k" {
		t.Fatal("secret didn't reach the keychain")
	}
	if _, err := os.Stat(Path()); !os.IsNotExist(err) {
		t.Fatal("file written while the keychain works")
	}
	if on, _ := Fallback(); on {
		t.Fatal("Fallback reported with a working keychain")
	}
}

func TestMovesToKeychainOnceAvailable(t *testing.T) {
	f := &fake{store: map[string]string{}, down: true}
	install(t, f)
	if err := Set("relay", "data-key", "k"); err != nil {
		t.Fatal(err)
	}
	f.down = false
	fellBack = false // a later launch
	if v, err := Get("relay", "data-key"); err != nil || v != "k" {
		t.Fatalf("Get = %q, %v", v, err)
	}
	if f.store["relay/data-key"] != "k" {
		t.Fatal("secret not moved into the keychain")
	}
	if _, err := os.Stat(Path()); !os.IsNotExist(err) {
		t.Fatal("file kept after its only secret moved")
	}
}

func TestRefusalIsNotFallback(t *testing.T) {
	f := &fake{store: map[string]string{}}
	install(t, f)
	refused := errors.New("prompt dismissed")
	osSet = func(string, string, string) error { return refused }
	if err := Set("relay", "x", "v"); !errors.Is(err, refused) {
		t.Fatalf("Set = %v, want the keychain's refusal", err)
	}
	if _, err := os.Stat(Path()); !os.IsNotExist(err) {
		t.Fatal("refused secret written to the file")
	}
}

func TestOnlyLinux(t *testing.T) {
	f := &fake{store: map[string]string{}, down: true}
	install(t, f)
	linux = false
	if err := Set("relay", "x", "v"); err == nil {
		t.Fatal("Set fell back off Linux")
	}
}

func TestUnavailable(t *testing.T) {
	for _, err := range []error{
		noService,
		errors.New("dbus: couldn't determine address of session bus"),
	} {
		if !unavailable(err) {
			t.Errorf("unavailable(%v) = false", err)
		}
	}
	for _, err := range []error{nil, ErrNotFound, errors.New("Cannot create an item in a locked collection")} {
		if unavailable(err) {
			t.Errorf("unavailable(%v) = true", err)
		}
	}
}
