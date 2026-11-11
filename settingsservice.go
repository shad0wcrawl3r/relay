package main

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/devto"
	"github.com/shad0wcrawl3r/relay/internal/keychain"
	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/shad0wcrawl3r/relay/internal/plane"
	"github.com/shad0wcrawl3r/relay/internal/term"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// SettingsService reads and writes settings: config.toml, and the keychain for
// secrets (internal/config/secrets.go). Secrets are never sent to the
// frontend: it only learns whether they are set, and blank inputs keep them.
type SettingsService struct {
	plane  *PlaneService
	posts  *PostService
	buffer *BufferService
}

// Integrations says which services are set up, without any network calls.
// Plane's state comes with its snapshot.
type Integrations struct {
	Buffer bool `json:"buffer"`
	Devto  bool `json:"devto"`
}

func (s *SettingsService) Integrations() Integrations {
	return currentIntegrations(s.buffer)
}

func currentIntegrations(b *BufferService) Integrations {
	return Integrations{Buffer: b != nil && b.client.Connected(), Devto: config.GetConfig().DevTo.APIKey != ""}
}

// integrationsChanged tells the frontend to move integrations between the
// sidebar's main sections and "Other integrations".
func integrationsChanged(b *BufferService) {
	if app := application.Get(); app != nil {
		app.Event.Emit("integrations:changed", currentIntegrations(b))
	}
}

type Settings struct {
	PlaneBaseURL      string `json:"planeBaseUrl"`
	PlaneAppURL       string `json:"planeAppUrl"`
	PlaneClientID     string `json:"planeClientId"`
	PlaneSecretSet    bool   `json:"planeSecretSet"`
	PlaneWorkspace    string `json:"planeWorkspace"`
	PlaneRedirectPort int    `json:"planeRedirectPort"`
	PlaneScope        string `json:"planeScope"`
	PlaneConnected    bool   `json:"planeConnected"`
	ConnectedSlug     string `json:"connectedSlug"`
	DevtoKeySet       bool   `json:"devtoKeySet"`
	// BufferInsightsKeySet: an optional personal key for Buffer post metrics.
	BufferInsightsKeySet bool   `json:"bufferInsightsKeySet"`
	SyncInterval         int    `json:"syncInterval"`
	AgentName            string `json:"agentName"`
	AgentLabel           string `json:"agentLabel"`
	ConfigPath           string `json:"configPath"`
	PostsDir             string `json:"postsDir"`
	RedirectURI          string `json:"redirectUri"`
	TerminalTmuxKeys     bool   `json:"terminalTmuxKeys"`
	// TerminalShell is the shell for new sessions; empty uses the default.
	TerminalShell   string `json:"terminalShell"`
	AutoLockMinutes int    `json:"autoLockMinutes"`
	// SecretsFile is set on Linux without a keychain: the plain file that
	// holds Relay's secrets instead (internal/keychain).
	SecretsFile string `json:"secretsFile"`
}

type SettingsInput struct {
	PlaneBaseURL      string `json:"planeBaseUrl"`
	PlaneAppURL       string `json:"planeAppUrl"`
	PlaneClientID     string `json:"planeClientId"`
	PlaneSecret       string `json:"planeSecret"`
	PlaneWorkspace    string `json:"planeWorkspace"`
	PlaneRedirectPort int    `json:"planeRedirectPort"`
	PlaneScope        string `json:"planeScope"`
	DevtoKey          string `json:"devtoKey"`
	SyncInterval      int    `json:"syncInterval"`
	AgentName         string `json:"agentName"`
	AgentLabel        string `json:"agentLabel"`
	TerminalTmuxKeys  bool   `json:"terminalTmuxKeys"`
	// TerminalShell is the shell for new sessions; empty uses the default.
	TerminalShell   string `json:"terminalShell"`
	AutoLockMinutes int    `json:"autoLockMinutes"`
}

func (s *SettingsService) Get() Settings {
	c := config.GetConfig()
	return Settings{
		PlaneBaseURL: c.Plane.BaseURL, PlaneAppURL: plane.AppURL(), PlaneClientID: c.Plane.ClientID,
		PlaneSecretSet: c.Plane.ClientSecret != "", PlaneWorkspace: c.Plane.Workspace,
		PlaneRedirectPort: c.Plane.RedirectPort, PlaneScope: c.Plane.Scope,
		PlaneConnected: s.plane.client.Connected(),
		ConnectedSlug:  s.plane.client.Workspace(), DevtoKeySet: c.DevTo.APIKey != "", BufferInsightsKeySet: c.Buffer.InsightsKey != "",
		SyncInterval: c.Sync.IntervalSeconds, AgentName: c.Agent.Name, AgentLabel: c.Agent.Label,
		ConfigPath: config.Path(), PostsDir: s.posts.store.Dir,
		RedirectURI:      "http://127.0.0.1:" + strconv.Itoa(c.Plane.RedirectPort) + "/oauth/callback",
		TerminalTmuxKeys: c.Terminal.TmuxKeys,
		TerminalShell:    usableShell(c.Terminal.Shell),
		AutoLockMinutes:  c.Privacy.AutoLockMinutes,
		SecretsFile:      secretsFile(),
	}
}

// secretsFile is the plain file holding Relay's secrets when there's no
// keychain; empty when the keychain is in use.
func secretsFile() string {
	if on, path := keychain.Fallback(); on {
		return path
	}
	return ""
}

func (s *SettingsService) Save(ctx context.Context, in SettingsInput) (Settings, error) {
	// A new Dev.to key must work before it replaces the saved one.
	if key := strings.TrimSpace(in.DevtoKey); key != "" {
		if _, err := s.CheckDevtoKey(ctx, key); err != nil {
			return Settings{}, err
		}
	}
	derivedAppURL := plane.AppURL()
	err := config.Update(func(c *config.Config) {
		c.Plane.BaseURL = in.PlaneBaseURL
		c.Plane.AppURL = in.PlaneAppURL
		if in.PlaneAppURL == derivedAppURL {
			// Leave it derived unless the user actually changed it.
			c.Plane.AppURL = ""
		}
		c.Plane.ClientID = strings.TrimSpace(in.PlaneClientID)
		if secret := strings.TrimSpace(in.PlaneSecret); secret != "" {
			c.Plane.ClientSecret = secret
		}
		c.Plane.Workspace = in.PlaneWorkspace
		c.Plane.Scope = strings.Join(strings.Fields(in.PlaneScope), " ")
		if in.PlaneRedirectPort > 0 {
			c.Plane.RedirectPort = in.PlaneRedirectPort
		}
		if key := strings.TrimSpace(in.DevtoKey); key != "" {
			c.DevTo.APIKey = key
		}
		if in.SyncInterval >= 30 {
			c.Sync.IntervalSeconds = in.SyncInterval
		}
		c.Agent.Name = in.AgentName
		c.Agent.Label = in.AgentLabel
		c.Terminal.TmuxKeys = in.TerminalTmuxKeys
		if in.TerminalShell == "" || term.Usable(in.TerminalShell) {
			c.Terminal.Shell = in.TerminalShell
		}
		if in.AutoLockMinutes >= 1 {
			c.Privacy.AutoLockMinutes = in.AutoLockMinutes
		}
	})
	if err != nil {
		logs.For("app").Error("settings save failed", "error", err)
		return Settings{}, err
	}
	logs.For("app").Info("settings saved")
	integrationsChanged(s.buffer)
	return s.Get(), nil
}

// usableShell hides a saved shell that doesn't exist here, so the form shows
// the default that sessions will actually use.
func usableShell(path string) string {
	if term.Usable(path) {
		return path
	}
	return ""
}

// SetBufferInsightsKey checks a Buffer personal API key and keeps it in the
// keychain. Relay uses it only to read post metrics.
func (s *SettingsService) SetBufferInsightsKey(ctx context.Context, key string) (Settings, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return Settings{}, errors.New("paste a Buffer API key")
	}
	if err := s.buffer.client.CheckKey(ctx, key); err != nil {
		return Settings{}, err
	}
	err := config.Update(func(c *config.Config) { c.Buffer.InsightsKey = key })
	s.buffer.dropInsights()
	logs.For("app").Info("buffer insights key saved")
	return s.Get(), err
}

// ClearBufferInsightsKey removes the Buffer insights key.
func (s *SettingsService) ClearBufferInsightsKey() (Settings, error) {
	err := config.Update(func(c *config.Config) { c.Buffer.InsightsKey = "" })
	s.buffer.dropInsights()
	return s.Get(), err
}

// ClearDevtoKey removes the stored Dev.to key.
func (s *SettingsService) ClearDevtoKey() (Settings, error) {
	err := config.Update(func(c *config.Config) { c.DevTo.APIKey = "" })
	integrationsChanged(s.buffer)
	return s.Get(), err
}

// SavePlaneApp stores the Plane OAuth app's credentials, for the setup guide.
// A blank secret keeps the saved one.
func (s *SettingsService) SavePlaneApp(clientID, secret, workspace string) (Settings, error) {
	err := config.Update(func(c *config.Config) {
		c.Plane.ClientID = strings.TrimSpace(clientID)
		if secret = strings.TrimSpace(secret); secret != "" {
			c.Plane.ClientSecret = secret
		}
		if workspace = strings.TrimSpace(workspace); workspace != "" {
			c.Plane.Workspace = workspace
		}
	})
	if err != nil {
		logs.For("app").Error("could not save the Plane app", "error", err)
	}
	return s.Get(), err
}

// DevtoKeyCheck is the account a Dev.to key belongs to.
type DevtoKeyCheck struct {
	Username string `json:"username"`
	Name     string `json:"name"`
}

// CheckDevtoKey asks Dev.to whether a key works, without saving it.
func (s *SettingsService) CheckDevtoKey(ctx context.Context, key string) (DevtoKeyCheck, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	u, err := devto.Check(ctx, key)
	return DevtoKeyCheck{Username: u.Username, Name: u.Name}, err
}

// SaveDevtoKey checks the Dev.to API key with Dev.to, then stores it.
func (s *SettingsService) SaveDevtoKey(ctx context.Context, key string) (Settings, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return s.Get(), nil
	}
	if _, err := s.CheckDevtoKey(ctx, key); err != nil {
		return s.Get(), err
	}
	err := config.Update(func(c *config.Config) { c.DevTo.APIKey = key })
	if err != nil {
		logs.For("app").Error("could not save the Dev.to key", "error", err)
	}
	integrationsChanged(s.buffer)
	return s.Get(), err
}

// ClearAllData deletes everything Relay stores (see cleardata.go), then
// quits. A copy of Relay clears again once this one has exited, catching
// anything written on the way out.
func (s *SettingsService) ClearAllData() error {
	logs.For("app").Notice("clearing all data")
	err := clearAllData(true)
	clearAfterQuit()
	// Let the reply reach the frontend before the window goes.
	time.AfterFunc(300*time.Millisecond, quit)
	return err
}
