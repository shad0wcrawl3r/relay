package config

import (
	"errors"
	"log"
	"os"

	"github.com/shad0wcrawl3r/relay/internal/keychain"
)

// Secrets live in the OS keychain, never in config.toml. The Config struct
// still carries them in memory so readers don't change. A RELAY_* env var
// wins over the keychain and is never copied into it.

const keyringService = "relay"

// KeyringService is the keychain service every Relay secret is stored under.
const KeyringService = keyringService

// stuck holds secrets the keychain refused at startup: they stay in the file
// rather than being lost. Guarded by writeMu.
var stuck = map[string]bool{}

type secret struct {
	user     string // keychain account
	viperKey string // key in config.toml (legacy) and the env override
	env      string
	field    func(*Config) *string
}

var secrets = []secret{
	{"devto-api-key", "devto.API_KEY", "RELAY_DEVTO_API_KEY", func(c *Config) *string { return &c.DevTo.APIKey }},
	{"plane-client-secret", "plane.CLIENT_SECRET", "RELAY_PLANE_CLIENT_SECRET", func(c *Config) *string { return &c.Plane.ClientSecret }},
}

func (s secret) fromEnv() bool { return os.Getenv(s.env) != "" }

// LoadSecrets reads secrets from the keychain, and moves any still in
// config.toml there, scrubbing them from the file. Call it once at startup,
// before anything reads a secret. Kept out of init so tests and tools that
// import config don't touch the real keychain.
func LoadSecrets() {
	writeMu.Lock()
	defer writeMu.Unlock()
	next := *GetConfig()
	scrub := false
	for _, s := range secrets {
		if s.fromEnv() {
			continue
		}
		f := s.field(&next)
		legacy := *f
		stored, err := keychain.Get(keyringService, s.user)
		switch {
		case err == nil:
			*f = stored
			// The keychain is newer than anything left in the file.
			scrub = scrub || legacy != ""
		case errors.Is(err, keychain.ErrNotFound):
			if legacy == "" {
				continue
			}
			if err := keychain.Set(keyringService, s.user, legacy); err != nil {
				log.Println("config: could not move", s.viperKey, "to the keychain; it stays in", Path(), "-", err)
				stuck[s.viperKey] = true
				continue
			}
			scrub = true
		default:
			// Leave whatever the file has: better than losing it.
			log.Println("config: could not read", s.viperKey, "from the keychain -", err)
			stuck[s.viperKey] = legacy != ""
		}
	}
	mu.Lock()
	cfg = next
	mu.Unlock()
	if !scrub {
		return
	}
	if _, err := os.Stat(Path()); err != nil {
		return
	}
	if err := write(next); err != nil {
		log.Println("config: could not scrub secrets from", Path(), "-", err)
	}
}

// storeSecrets writes changed secrets to the keychain. Values from env vars
// are left alone.
func storeSecrets(prev, next Config) error {
	for _, s := range secrets {
		if s.fromEnv() {
			continue
		}
		before, after := *s.field(&prev), *s.field(&next)
		if before == after {
			continue
		}
		var err error
		if after == "" {
			err = keychain.Delete(keyringService, s.user)
			if errors.Is(err, keychain.ErrNotFound) {
				err = nil
			}
		} else {
			err = keychain.Set(keyringService, s.user, after)
		}
		if err != nil {
			return errors.New("could not save " + s.viperKey + " to the system keychain: " + err.Error())
		}
		delete(stuck, s.viperKey)
	}
	return nil
}

// fileValue is what config.toml gets for a secret: nothing, unless the
// keychain refused it at startup.
func fileValue(s secret, c *Config) string {
	if stuck[s.viperKey] {
		return *s.field(c)
	}
	return ""
}
