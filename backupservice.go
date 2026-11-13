package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/ai"
	"github.com/shad0wcrawl3r/relay/internal/backup"
	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/keychain"
	"github.com/shad0wcrawl3r/relay/internal/term"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Settings export and import: config.toml's settings plus the keychain's API
// keys, sealed with a word passphrase (internal/backup). Sign-ins (Buffer and
// Plane tokens) and the vault key stay behind: they belong to this device,
// and signing in again on the new one takes a click each.

const (
	backupExt     = ".relaysettings"
	backupKeyUser = "backup-key"
	// Exports are a few kilobytes; anything far bigger isn't one.
	maxBackupSize = 1 << 20
)

// settingsBundle is what an export carries. Its JSON must be the same for the
// same settings: the passphrase is derived from it.
type settingsBundle struct {
	Version int               `json:"version"`
	Config  config.Config     `json:"config"`
	AIKeys  map[string]string `json:"aiKeys,omitempty"`
}

// ExportResult tells the user where the file went and how to open it.
type ExportResult struct {
	Path       string   `json:"path"`
	Passphrase string   `json:"passphrase"`
	Words      []string `json:"words"`
}

// ImportResult lists what an import brought in, for the confirmation.
type ImportResult struct {
	Imported []string `json:"imported"`
	// ShellKept is set when the file's shell doesn't exist on this machine.
	ShellKept bool `json:"shellKept"`
}

// backupKey is this device's secret for deriving passphrases, created on the
// first export. Losing it only means the next export gets new words.
func backupKey() ([]byte, error) {
	stored, err := keychain.Get(config.KeyringService, backupKeyUser)
	if err == nil {
		if key, err := base64.StdEncoding.DecodeString(stored); err == nil && len(key) == 32 {
			return key, nil
		}
	} else if !errors.Is(err, keychain.ErrNotFound) {
		return nil, fmt.Errorf("could not read the system keychain: %w", err)
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := keychain.Set(config.KeyringService, backupKeyUser, base64.StdEncoding.EncodeToString(key)); err != nil {
		return nil, fmt.Errorf("could not save to the system keychain: %w", err)
	}
	return key, nil
}

func currentBundle() (settingsBundle, error) {
	c := *config.GetConfig()
	// Whether the guide was finished is about this device.
	c.Onboarding.Done = false
	b := settingsBundle{Version: 1, Config: c, AIKeys: map[string]string{}}
	for _, p := range ai.Providers() {
		key, err := ai.Key(p.ID)
		if err != nil {
			return b, fmt.Errorf("could not read the %s key from the system keychain: %w", p.Name, err)
		}
		if key != "" {
			b.AIKeys[p.ID] = key
		}
	}
	return b, nil
}

// downloadsDir is the user's Downloads folder, or home when there isn't one.
func downloadsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	if d := filepath.Join(home, "Downloads"); isDir(d) {
		return d, nil
	}
	return home, nil
}

func isDir(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

// ExportSettings writes the sealed settings to Downloads and returns the
// passphrase. The same settings always get the same words.
func (s *SettingsService) ExportSettings() (ExportResult, error) {
	b, err := currentBundle()
	if err != nil {
		return ExportResult{}, err
	}
	payload, err := json.Marshal(b)
	if err != nil {
		return ExportResult{}, err
	}
	key, err := backupKey()
	if err != nil {
		return ExportResult{}, err
	}
	pass := backup.Passphrase(key, payload)
	sealed, err := backup.Seal(payload, pass)
	if err != nil {
		return ExportResult{}, err
	}
	dir, err := downloadsDir()
	if err != nil {
		return ExportResult{}, err
	}
	path, err := writeNew(dir, "relay-settings-"+time.Now().Format("2006-01-02"), backupExt, sealed)
	if err != nil {
		return ExportResult{}, fmt.Errorf("could not save the file: %w", err)
	}
	return ExportResult{Path: path, Passphrase: pass, Words: strings.Fields(pass)}, nil
}

// writeNew writes data to dir/base+ext, numbering the name rather than
// replacing an earlier export.
func writeNew(dir, base, ext string, data []byte) (string, error) {
	for i := 1; i < 1000; i++ {
		name := base + ext
		if i > 1 {
			name = fmt.Sprintf("%s-%d%s", base, i, ext)
		}
		path := filepath.Join(dir, name)
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		_, werr := f.Write(data)
		if cerr := f.Close(); werr == nil {
			werr = cerr
		}
		if werr != nil {
			os.Remove(path)
			return "", werr
		}
		return path, nil
	}
	return "", errors.New("too many exports with today's date in " + dir)
}

// RevealExport shows an exported file in Finder or Explorer.
func (s *SettingsService) RevealExport(path string) error {
	if filepath.Ext(path) != backupExt {
		return errors.New("not a settings export")
	}
	return application.Get().Env.OpenFileManager(path, true)
}

// ChooseSettingsFile asks for an export to import. Empty when cancelled.
func (s *SettingsService) ChooseSettingsFile() (string, error) {
	dir, _ := downloadsDir()
	return application.Get().Dialog.OpenFile().
		SetTitle("Import Relay settings").
		CanChooseFiles(true).
		SetDirectory(dir).
		AddFilter("Relay settings", "*"+backupExt).
		PromptForSingleSelection()
}

// ImportSettings opens an export with its passphrase and replaces this
// device's settings and API keys with it. Nothing changes unless the
// passphrase is right.
func (s *SettingsService) ImportSettings(path, passphrase string) (ImportResult, error) {
	f, err := os.Open(path)
	if err != nil {
		return ImportResult{}, fmt.Errorf("could not open the file: %w", err)
	}
	data, err := io.ReadAll(io.LimitReader(f, maxBackupSize+1))
	f.Close()
	if err != nil {
		return ImportResult{}, err
	}
	if len(data) > maxBackupSize {
		return ImportResult{}, backup.ErrNotBackup
	}
	payload, err := backup.Open(data, passphrase)
	if err != nil {
		return ImportResult{}, err
	}
	var b settingsBundle
	if err := json.Unmarshal(payload, &b); err != nil || b.Version != 1 {
		return ImportResult{}, backup.ErrNotBackup
	}
	return s.applyBundle(b)
}

func (s *SettingsService) applyBundle(b settingsBundle) (ImportResult, error) {
	var res ImportResult
	for id, key := range b.AIKeys {
		p, ok := ai.Find(id)
		if !ok || key == "" {
			continue
		}
		if err := ai.SetKey(id, key); err != nil {
			return res, fmt.Errorf("could not save the %s key to the system keychain: %w", p.Name, err)
		}
		res.Imported = append(res.Imported, p.Name+" key")
	}
	err := config.Update(func(c *config.Config) {
		next := b.Config
		next.Onboarding = c.Onboarding
		// An import never unlocks anything: projects locked here stay locked.
		for _, l := range c.Privacy.Locked {
			if !slices.Contains(next.Privacy.Locked, l) {
				next.Privacy.Locked = append(next.Privacy.Locked, l)
			}
		}
		// A shell from another machine (zsh on a Mac, say) may not exist here.
		if next.Terminal.Shell != "" && !term.Usable(next.Terminal.Shell) {
			next.Terminal.Shell = c.Terminal.Shell
			res.ShellKept = true
		}
		*c = next
	})
	if err != nil {
		return res, err
	}
	c := config.GetConfig()
	if c.DevTo.APIKey != "" {
		res.Imported = append(res.Imported, "Dev.to key")
	}
	if c.Plane.ClientID != "" {
		res.Imported = append(res.Imported, "Plane app")
	}
	if c.Buffer.ClientID != "" {
		res.Imported = append(res.Imported, "Buffer app")
	}
	slices.Sort(res.Imported)
	res.Imported = append([]string{"Settings"}, res.Imported...)
	integrationsChanged(s.buffer)
	return res, nil
}
