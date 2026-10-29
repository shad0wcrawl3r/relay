package main

import (
	"strconv"
	"strings"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/plane"
)

// SettingsService reads and writes config.toml. Secrets are never sent to the
// frontend: it only learns whether they are set, and blank inputs keep them.
type SettingsService struct {
	plane *PlaneService
	posts *PostService
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
	SyncInterval      int    `json:"syncInterval"`
	AgentName         string `json:"agentName"`
	AgentLabel        string `json:"agentLabel"`
	ConfigPath        string `json:"configPath"`
	PostsDir          string `json:"postsDir"`
	RedirectURI       string `json:"redirectUri"`
	TerminalTmuxKeys  bool   `json:"terminalTmuxKeys"`
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
}

func (s *SettingsService) Get() Settings {
	c := config.GetConfig()
	return Settings{
		PlaneBaseURL: c.Plane.BaseURL, PlaneAppURL: plane.AppURL(), PlaneClientID: c.Plane.ClientID,
		PlaneSecretSet: c.Plane.ClientSecret != "", PlaneWorkspace: c.Plane.Workspace,
		PlaneRedirectPort: c.Plane.RedirectPort, PlaneScope: c.Plane.Scope,
		PlaneConnected: s.plane.client.Connected(),
		ConnectedSlug:  s.plane.client.Workspace(), DevtoKeySet: c.DevTo.APIKey != "",
		SyncInterval: c.Sync.IntervalSeconds, AgentName: c.Agent.Name, AgentLabel: c.Agent.Label,
		ConfigPath: config.Path(), PostsDir: s.posts.store.Dir,
		RedirectURI:      "http://127.0.0.1:" + strconv.Itoa(c.Plane.RedirectPort) + "/oauth/callback",
		TerminalTmuxKeys: c.Terminal.TmuxKeys,
	}
}

func (s *SettingsService) Save(in SettingsInput) (Settings, error) {
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
	})
	if err != nil {
		return Settings{}, err
	}
	return s.Get(), nil
}

// ClearDevtoKey removes the stored Dev.to key.
func (s *SettingsService) ClearDevtoKey() (Settings, error) {
	err := config.Update(func(c *config.Config) { c.DevTo.APIKey = "" })
	return s.Get(), err
}
