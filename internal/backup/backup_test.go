package backup

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestWordlist(t *testing.T) {
	if len(wordlist) != 7776 {
		t.Fatalf("wordlist has %d words, want 7776", len(wordlist))
	}
}

func TestPassphraseDeterministic(t *testing.T) {
	key := []byte("device-key")
	a := Passphrase(key, []byte(`{"x":1}`))
	if a != Passphrase(key, []byte(`{"x":1}`)) {
		t.Fatal("same settings gave different words")
	}
	if len(strings.Fields(a)) != Words {
		t.Fatalf("got %q, want %d words", a, Words)
	}
	if a == Passphrase(key, []byte(`{"x":2}`)) {
		t.Fatal("changed settings kept the words")
	}
	if a == Passphrase([]byte("other-device"), []byte(`{"x":1}`)) {
		t.Fatal("another device key gave the same words")
	}
}

func TestSealOpen(t *testing.T) {
	payload := []byte(`{"devto":"secret"}`)
	pass := "abacus zoom ladder pickle velvet orbit"
	sealed, err := Seal(payload, pass)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("secret")) {
		t.Fatal("plaintext in the file")
	}
	got, err := Open(sealed, "  Abacus-Zoom, LADDER\npickle velvet orbit ")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("got %q", got)
	}
	if _, err := Open(sealed, "abacus zoom ladder pickle velvet"); !errors.Is(err, ErrWrongPassphrase) {
		t.Fatalf("short passphrase: %v", err)
	}
	if _, err := Open(sealed, "orbit zoom ladder pickle velvet abacus"); !errors.Is(err, ErrWrongPassphrase) {
		t.Fatalf("reordered passphrase: %v", err)
	}
	// Two exports of the same settings are still different files.
	again, _ := Seal(payload, pass)
	if bytes.Equal(again, sealed) {
		t.Fatal("same salt and nonce twice")
	}
}

func TestOpenRejectsTampering(t *testing.T) {
	pass := "abacus zoom ladder pickle velvet orbit"
	sealed, _ := Seal([]byte("x"), pass)
	var f map[string]any
	_ = json.Unmarshal(sealed, &f)
	f["time"] = 1
	edited, _ := json.Marshal(f)
	if _, err := Open(edited, pass); !errors.Is(err, ErrWrongPassphrase) {
		t.Fatalf("edited parameters: %v", err)
	}
	f["memory"] = 1 << 30
	edited, _ = json.Marshal(f)
	if _, err := Open(edited, pass); !errors.Is(err, ErrNotBackup) {
		t.Fatalf("huge memory: %v", err)
	}
	if _, err := Open([]byte("[plane]\nCLIENT_ID = 'x'"), pass); !errors.Is(err, ErrNotBackup) {
		t.Fatalf("other file: %v", err)
	}
}
