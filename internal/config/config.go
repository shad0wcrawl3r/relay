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

// Update applies fn to a copy of the config and persists it to Path().
func Update(fn func(c *Config)) error {
	writeMu.Lock()
	defer writeMu.Unlock()
	next := *GetConfig()
	fn(&next)
	v.Set("devto.API_KEY", next.DevTo.APIKey)
	v.Set("plane.BASE_URL", next.Plane.BaseURL)
	v.Set("plane.APP_URL", next.Plane.AppURL)
	v.Set("plane.CLIENT_ID", next.Plane.ClientID)
	v.Set("plane.CLIENT_SECRET", next.Plane.ClientSecret)
	v.Set("plane.WORKSPACE", next.Plane.Workspace)
	v.Set("plane.REDIRECT_PORT", next.Plane.RedirectPort)
	v.Set("plane.SCOPE", next.Plane.Scope)
	v.Set("sync.INTERVAL_SECONDS", next.Sync.IntervalSeconds)
	v.Set("agent.NAME", next.Agent.Name)
	v.Set("agent.LABEL", next.Agent.Label)
	v.Set("terminal.SHELL", next.Terminal.Shell)
	v.Set("terminal.SCROLLBACK", next.Terminal.Scrollback)
	path := Path()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := v.WriteConfigAs(path); err != nil {
		return err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return err
	}
	mu.Lock()
	cfg = next
	mu.Unlock()
	return nil
}

type Config struct {
	DevTo struct {
		APIKey string `mapstructure:"API_KEY"`
	}
	Plane struct {
		BaseURL string `mapstructure:"BASE_URL"`
		// AppURL is the web UI ("Open in Plane"); derived from BaseURL when empty.
		AppURL       string `mapstructure:"APP_URL"`
		ClientID     string `mapstructure:"CLIENT_ID"`
		ClientSecret string `mapstructure:"CLIENT_SECRET"`
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
	}
}
