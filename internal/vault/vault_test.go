package vault

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/zalando/go-keyring"
)

func TestRoundTrip(t *testing.T) {
	keyring.MockInit()
	Reset()
	dir := t.TempDir()
	p := filepath.Join(dir, "cache.json")
	secret := []byte(`{"project":"TEACH","item":"thesis draft"}`)
	if err := WriteFile(p, secret); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(p)
	if bytes.Contains(raw, []byte("TEACH")) || bytes.Contains(raw, []byte("thesis")) {
		t.Fatal("plaintext on disk")
	}
	if st, _ := os.Stat(p); st.Mode().Perm() != 0o600 {
		t.Errorf("mode %v", st.Mode().Perm())
	}
	got, err := ReadFile(p)
	if err != nil || !bytes.Equal(got, secret) {
		t.Fatalf("got %q err %v", got, err)
	}

	// A sealed file renamed to another purpose doesn't open.
	other := filepath.Join(dir, "layout.json")
	os.WriteFile(other, raw, 0o600)
	if _, err := ReadFile(other); err == nil {
		t.Error("label not enforced")
	}
	// Plaintext from older versions is reported, not misparsed.
	os.WriteFile(p, []byte(`{}`), 0o600)
	if _, err := ReadFile(p); err != ErrNotSealed {
		t.Errorf("plaintext: %v", err)
	}
	// Tampering is detected.
	raw[len(raw)-1] ^= 1
	os.WriteFile(p, raw, 0o600)
	if _, err := ReadFile(p); err == nil {
		t.Error("tampering not detected")
	}
}

func TestKeyPersistsInKeychain(t *testing.T) {
	keyring.MockInit()
	Reset()
	a, err := Seal([]byte("x"), "l")
	if err != nil {
		t.Fatal(err)
	}
	Reset() // a new process: key must come back from the keychain
	if pt, err := Open(a, "l"); err != nil || string(pt) != "x" {
		t.Fatalf("%q %v", pt, err)
	}
}
