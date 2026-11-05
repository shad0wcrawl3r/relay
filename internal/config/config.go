package config

import (
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/spf13/viper"
)

var (
	mu sync.RWMutex // guards cfg
	// writeMu serialises Update. fn runs without mu held, so it may call
	// GetConfig (directly or via helpers) without deadlocking.
	writeMu sync.Mutex
	cfg     Config
	v       = viper.New()
)

func init() {
	v.SetEnvPrefix("RELAY")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()
	v.SetConfigFile(Path())
	v.SetConfigType("toml")
	v.SetDefault("plane.BASE_URL", "https://api.plane.so")
	v.SetDefault("plane.REDIRECT_PORT", 47821)
	// Empty: request no explicit scope, so Plane grants the scopes ticked on
	// the OAuth app. Asking for any scope the app lacks fails with invalid_scope.
	v.SetDefault("plane.SCOPE", "")
	v.SetDefault("sync.INTERVAL_SECONDS", 120)
	v.SetDefault("agent.NAME", "Claude Code")
	v.SetDefault("agent.LABEL", "agent")
	// Empty shell: $SHELL.
	v.SetDefault("terminal.SHELL", "")
	v.SetDefault("terminal.SCROLLBACK", 10000)
	v.SetDefault("terminal.TMUX_KEYS", false)
	// Lockable Plane projects ("project:<IDENTIFIER>") and modules
	// ("module:<id>"): hidden until the device owner unlocks them.
	v.SetDefault("privacy.LOCKED", []string{"project:TEACH"})
	v.SetDefault("privacy.AUTO_LOCK_MINUTES", 15)
	v.SetDefault("logs.ENABLED", false)
	if err := v.ReadInConfig(); err != nil {
		// A missing file is fine: the user fills it in from Settings.
		var notFound viper.ConfigFileNotFoundError
		if !errors.As(err, &notFound) && !os.IsNotExist(err) {
			log.Println("config: could not read", Path(), "-", err)
		}
	}
	if err := v.Unmarshal(&cfg); err != nil {
		log.Panic("Could not unmarshall config. Err: ", err)
	}
	// Never log cfg itself: it holds secrets.
}

// Path is the config file in use: ./config.toml when present (dev), otherwise
// the OS config dir (e.g. ~/Library/Application Support/relay/config.toml).
func Path() string {
	if _, err := os.Stat("config.toml"); err == nil {
		return "config.toml"
	}
	return filepath.Join(AppDir(), "config.toml")
}

// AppDir is Relay's directory in the OS app-storage location.
func AppDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "relay")
}

func GetConfig() *Config {
	mu.RLock()
	defer mu.RUnlock()
	c := cfg
	return &c
}

// Override applies fn in memory only, without touching config.toml.
func Override(fn func(c *Config)) {
	mu.Lock()
	defer mu.Unlock()
	fn(&cfg)
}

// Update applies fn to a copy of the config and persists it: secrets to the
// keychain, the rest to Path().
func Update(fn func(c *Config)) error {
	writeMu.Lock()
	defer writeMu.Unlock()
	prev := *GetConfig()
	next := prev
	fn(&next)
	if err := storeSecrets(prev, next); err != nil {
		return err
	}
	if err := write(next); err != nil {
		return err
	}
	mu.Lock()
	cfg = next
	mu.Unlock()
	return nil
}

// write saves next to Path(). Caller holds writeMu.
func write(next Config) error {
	for _, s := range secrets {
		// Also overrides an env value, which must not reach the file either.
		v.Set(s.viperKey, fileValue(s, &next))
	}
	v.Set("plane.BASE_URL", next.Plane.BaseURL)
	v.Set("plane.APP_URL", next.Plane.AppURL)
	v.Set("plane.CLIENT_ID", next.Plane.ClientID)
	v.Set("plane.WORKSPACE", next.Plane.Workspace)
	v.Set("plane.REDIRECT_PORT", next.Plane.RedirectPort)
	v.Set("plane.SCOPE", next.Plane.Scope)
	v.Set("sync.INTERVAL_SECONDS", next.Sync.IntervalSeconds)
	v.Set("agent.NAME", next.Agent.Name)
	v.Set("agent.LABEL", next.Agent.Label)
	v.Set("terminal.SHELL", next.Terminal.Shell)
	v.Set("terminal.SCROLLBACK", next.Terminal.Scrollback)
	v.Set("terminal.TMUX_KEYS", next.Terminal.TmuxKeys)
	v.Set("privacy.LOCKED", next.Privacy.Locked)
	v.Set("privacy.AUTO_LOCK_MINUTES", next.Privacy.AutoLockMinutes)
	v.Set("ai.PROVIDER", next.AI.Provider)
	v.Set("ai.MODEL", next.AI.Model)
	v.Set("ai.ENDPOINTS", next.AI.Endpoints)
	v.Set("ai.PRIVATE", next.AI.Private)
	v.Set("logs.ENABLED", next.Logs.Enabled)
	v.Set("logs.LEVELS", next.Logs.Levels)
	v.Set("onboarding.DONE", next.Onboarding.Done)
	path := Path()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := v.WriteConfigAs(path); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

type Config struct {
	DevTo struct {
		// APIKey lives in the keychain (secrets.go); here in memory only.
		APIKey string `mapstructure:"API_KEY"`
	}
	Plane struct {
		BaseURL string `mapstructure:"BASE_URL"`
		// AppURL is the web UI ("Open in Plane"); derived from BaseURL when empty.
		AppURL       string `mapstructure:"APP_URL"`
		ClientID     string `mapstructure:"CLIENT_ID"`
		ClientSecret string `mapstructure:"CLIENT_SECRET"` // keychain; in memory only
		// Workspace slug; normally discovered from the app installation.
		Workspace    string `mapstructure:"WORKSPACE"`
		RedirectPort int    `mapstructure:"REDIRECT_PORT"`
		Scope        string `mapstructure:"SCOPE"`
	}
	Sync struct {
		IntervalSeconds int `mapstructure:"INTERVAL_SECONDS"`
	}
	Agent struct {
		// Name is the Plane display name the agent comments as.
		Name string `mapstructure:"NAME"`
		// Label marks a work item as agent-handled.
		Label string `mapstructure:"LABEL"`
	}
	Terminal struct {
		// Shell for new sessions; empty uses $SHELL.
		Shell      string `mapstructure:"SHELL"`
		Scrollback int    `mapstructure:"SCROLLBACK"`
		// TmuxKeys reads prefix and bindings from the user's tmux config.
		TmuxKeys bool `mapstructure:"TMUX_KEYS"`
	}
	AI struct {
		// Provider and Model are used for summaries; keys live in the keychain.
		Provider string `mapstructure:"PROVIDER"`
		Model    string `mapstructure:"MODEL"`
		// Endpoints overrides a provider's base URL, keyed by provider ID.
		Endpoints map[string]string `mapstructure:"ENDPOINTS"`
		// Private marks cloud providers the user trusts with private projects,
		// keyed by provider ID. The value is the endpoint it was marked for,
		// so pointing the provider somewhere else drops the mark.
		Private map[string]string `mapstructure:"PRIVATE"`
	}
	Logs struct {
		Enabled bool `mapstructure:"ENABLED"`
		// Levels maps a subsystem to its level, e.g. ai = "debug".
		Levels map[string]string `mapstructure:"LEVELS"`
	}
	Privacy struct {
		Locked          []string `mapstructure:"LOCKED"`
		AutoLockMinutes int      `mapstructure:"AUTO_LOCK_MINUTES"`
	}
	Onboarding struct {
		// Done is set once the setup guide is finished or dismissed.
		Done bool `mapstructure:"DONE"`
	}
}
