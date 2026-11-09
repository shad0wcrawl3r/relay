package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestVerifySum(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "relay.exe")
	if err := os.WriteFile(file, []byte("new relay"), 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte("new relay"))
	good := hex.EncodeToString(sum[:])
	sums := filepath.Join(dir, "SHA256SUMS")
	write := func(s string) {
		if err := os.WriteFile(sums, []byte(s), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	write("0000  relay.deb\n" + good + "  relay.exe\n")
	if err := verifySum(file, sums, "relay.exe"); err != nil {
		t.Fatalf("matching sum rejected: %v", err)
	}
	write(good + " *relay.exe\n") // binary-mode marker
	if err := verifySum(file, sums, "relay.exe"); err != nil {
		t.Fatalf("binary-mode line rejected: %v", err)
	}
	write("deadbeef  relay.exe\n")
	if err := verifySum(file, sums, "relay.exe"); err == nil {
		t.Fatal("wrong sum accepted")
	}
	write(good + "  relay-other.exe\n")
	if err := verifySum(file, sums, "relay.exe"); err == nil {
		t.Fatal("missing entry accepted")
	}
}

func TestAppBundle(t *testing.T) {
	cases := map[string]string{
		"/Applications/relay.app/Contents/MacOS/relay": "/Applications/relay.app",
		"/Users/a/bin/relay":                            "",
		"/Applications/relay.app/Contents/Other/relay":  "",
	}
	for exe, want := range cases {
		if got := appBundle(exe); got != want {
			t.Errorf("appBundle(%q) = %q, want %q", exe, got, want)
		}
	}
}

func TestDevBuildsDontSelfInstall(t *testing.T) {
	// Tests build without -tags production, like wails3 dev.
	if releaseBuild {
		t.Skip("release build")
	}
	s := NewUpdateService()
	if err := s.Install(t.Context()); err == nil {
		t.Fatal("Install ran with no update found")
	}
}
