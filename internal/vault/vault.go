// Package vault encrypts everything Relay stores on disk with a random
// AES-256 key that lives only in the OS keychain (macOS Keychain, Windows
// Credential Manager, Secret Service on Linux).
package vault

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/zalando/go-keyring"
)

const (
	keyringService = "relay"
	keyringUser    = "data-key"
)

// magic prefixes every sealed file, so plaintext from older versions is
// recognised and never parsed as ciphertext (or vice versa).
var magic = []byte("RLYV1\x00")

// ErrNotSealed is returned by ReadFile for a file Relay wrote unencrypted.
var ErrNotSealed = errors.New("vault: file is not encrypted")

var (
	mu  sync.Mutex
	key []byte
)

// dataKey loads the key from the keychain, creating it on first use.
func dataKey() ([]byte, error) {
	mu.Lock()
	defer mu.Unlock()
	if key != nil {
		return key, nil
	}
	raw, err := keyring.Get(keyringService, keyringUser)
	switch {
	case err == nil:
		k, derr := base64.StdEncoding.DecodeString(raw)
		if derr != nil || len(k) != 32 {
			return nil, errors.New("vault: keychain item is corrupt")
		}
		key = k
	case errors.Is(err, keyring.ErrNotFound):
		k := make([]byte, 32)
		if _, err := rand.Read(k); err != nil {
			return nil, err
		}
		if err := keyring.Set(keyringService, keyringUser, base64.StdEncoding.EncodeToString(k)); err != nil {
			return nil, fmt.Errorf("vault: could not store key in the keychain: %w", err)
		}
		key = k
	default:
		return nil, fmt.Errorf("vault: keychain unavailable: %w", err)
	}
	return key, nil
}

func aead() (cipher.AEAD, error) {
	k, err := dataKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(k)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Seal encrypts plaintext. label binds the ciphertext to its purpose (e.g.
// the file name), so one sealed file can't be swapped in for another.
func Seal(plaintext []byte, label string) ([]byte, error) {
	g, err := aead()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, g.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	out := append(append([]byte{}, magic...), nonce...)
	return g.Seal(out, nonce, plaintext, []byte(label)), nil
}

// Open decrypts what Seal produced with the same label.
func Open(sealed []byte, label string) ([]byte, error) {
	if !bytes.HasPrefix(sealed, magic) {
		return nil, ErrNotSealed
	}
	g, err := aead()
	if err != nil {
		return nil, err
	}
	body := sealed[len(magic):]
	if len(body) < g.NonceSize() {
		return nil, errors.New("vault: truncated file")
	}
	pt, err := g.Open(nil, body[:g.NonceSize()], body[g.NonceSize():], []byte(label))
	if err != nil {
		return nil, errors.New("vault: file can't be decrypted with this keychain's key")
	}
	return pt, nil
}

// WriteFile seals data and writes it atomically with 0600 permissions. The
// file's base name is the label.
func WriteFile(path string, data []byte) error {
	sealed, err := Seal(data, filepath.Base(path))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, sealed, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ReadFile reads and opens a file written by WriteFile.
func ReadFile(path string) ([]byte, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Open(b, filepath.Base(path))
}

// Reset forgets the cached key (tests, or after the keychain item changes).
func Reset() {
	mu.Lock()
	key = nil
	mu.Unlock()
}
