// Package backup seals Relay's settings, secrets included, into a file that
// only opens with a passphrase of ordinary words. It is fully offline: the
// passphrase is never stored or sent anywhere, and the file holds only the
// sealed data and the parameters needed to open it.
//
// The passphrase is deterministic: an HMAC, keyed by a secret that never
// leaves this device, of the settings being sealed. Exporting unchanged
// settings again gives the same words; any change gives new ones. Without the
// device secret the words can't be derived from the settings, and without the
// words the file can't be opened.
package backup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"unicode"

	"golang.org/x/crypto/argon2"
)

// words is the EFF large wordlist (7,776 words), by the Electronic Frontier
// Foundation, CC BY 3.0: https://www.eff.org/dice
//
//go:embed words.txt
var wordsFile string

var wordlist = strings.Fields(wordsFile)

// Words in a passphrase. Six from 7,776 is about 77 bits, and every guess
// costs an Argon2id derivation.
const Words = 6

const (
	format  = "relay-settings"
	version = 1
	// Argon2id parameters for new files: 64 MiB, three passes.
	argonTime    = 3
	argonMemory  = 64 * 1024
	argonThreads = 4
	// Limits for opening a file, so a crafted one can't ask for gigabytes.
	maxTime   = 10
	maxMemory = 1024 * 1024
)

// ErrWrongPassphrase means the passphrase doesn't open the file. Argon2id and
// AES-GCM can't tell a mistyped word from a tampered file, so it covers both.
var ErrWrongPassphrase = errors.New("that passphrase doesn't open this file; check the words and their order")

// ErrNotBackup means the file isn't a Relay settings export.
var ErrNotBackup = errors.New("this isn't a Relay settings file")

// header is the readable part of the file. It is bound to the sealed data as
// additional data, so changing any parameter breaks the seal.
type header struct {
	Format  string `json:"format"`
	Version int    `json:"version"`
	KDF     string `json:"kdf"`
	Time    uint32 `json:"time"`
	Memory  uint32 `json:"memory"`
	Threads uint8  `json:"threads"`
	Salt    []byte `json:"salt"`
	Nonce   []byte `json:"nonce"`
}

type file struct {
	header
	Data []byte `json:"data"`
}

func (h header) aad() []byte {
	b, _ := json.Marshal(h)
	return b
}

// Passphrase derives the words for payload. deviceKey is this device's
// secret; payload must be the same bytes for the same settings.
func Passphrase(deviceKey, payload []byte) string {
	mac := hmac.New(sha256.New, deviceKey)
	mac.Write([]byte(format + "/passphrase\x00"))
	mac.Write(payload)
	n := new(big.Int).SetBytes(mac.Sum(nil))
	size := big.NewInt(int64(len(wordlist)))
	out := make([]string, Words)
	idx := new(big.Int)
	for i := range out {
		n.DivMod(n, size, idx)
		out[i] = wordlist[idx.Int64()]
	}
	return strings.Join(out, " ")
}

// Normalise accepts the words however they were typed: any case, separated
// by spaces, hyphens, commas or new lines.
func Normalise(passphrase string) string {
	f := strings.FieldsFunc(strings.ToLower(passphrase), func(r rune) bool { return !unicode.IsLetter(r) })
	return strings.Join(f, " ")
}

func aead(passphrase string, h header) (cipher.AEAD, error) {
	key := argon2.IDKey([]byte(Normalise(passphrase)), h.Salt, h.Time, h.Memory, h.Threads, 32)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Seal encrypts payload under passphrase and returns the file's bytes.
func Seal(payload []byte, passphrase string) ([]byte, error) {
	if Normalise(passphrase) == "" {
		return nil, errors.New("empty passphrase")
	}
	h := header{Format: format, Version: version, KDF: "argon2id", Time: argonTime, Memory: argonMemory, Threads: argonThreads,
		Salt: make([]byte, 16), Nonce: make([]byte, 12)}
	if _, err := rand.Read(h.Salt); err != nil {
		return nil, err
	}
	if _, err := rand.Read(h.Nonce); err != nil {
		return nil, err
	}
	gcm, err := aead(passphrase, h)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(file{header: h, Data: gcm.Seal(nil, h.Nonce, payload, h.aad())}, "", "  ")
}

// Open decrypts a file made by Seal.
func Open(data []byte, passphrase string) ([]byte, error) {
	var f file
	if err := json.Unmarshal(data, &f); err != nil || f.Format != format {
		return nil, ErrNotBackup
	}
	h := f.header
	switch {
	case h.Version != version:
		return nil, fmt.Errorf("this settings file is from a newer Relay (format %d); update Relay to import it", h.Version)
	case h.KDF != "argon2id", h.Time == 0, h.Time > maxTime, h.Memory == 0, h.Memory > maxMemory, h.Threads == 0,
		len(h.Salt) < 16, len(h.Nonce) != 12:
		return nil, ErrNotBackup
	}
	gcm, err := aead(passphrase, h)
	if err != nil {
		return nil, err
	}
	out, err := gcm.Open(nil, h.Nonce, f.Data, h.aad())
	if err != nil {
		return nil, ErrWrongPassphrase
	}
	return out, nil
}
