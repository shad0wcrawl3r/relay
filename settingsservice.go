package main

import (
	"strconv"

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
	PlaneConnected    bool   `json:"planeConnected"`
	ConnectedSlug     string `json:"connectedSlug"`
	DevtoKeySet       bool   `json:"devtoKeySet"`
	SyncInterval      int    `json:"syncInterval"`
	AgentName         string `json:"agentName"`
	AgentLabel        string `json:"agentLabel"`
	ConfigPath        string `json:"configPath"`
	PostsDir          string `json:"postsDir"`
	RedirectURI       string `json:"redirectUri"`
}

type SettingsInput struct {
	PlaneBaseURL      string `json:"planeBaseUrl"`
	PlaneAppURL       string `json:"planeAppUrl"`
	PlaneClientID     string `json:"planeClientId"`
	PlaneSecret       string `json:"planeSecret"`
	PlaneWorkspace    string `json:"planeWorkspace"`
	PlaneRedirectPort int    `json:"planeRedirectPort"`
	DevtoKey          string `json:"devtoKey"`
	SyncInterval      int    `json:"syncInterval"`
	AgentName         string `json:"agentName"`
	AgentLabel        string `json:"agentLabel"`
}

func (s *SettingsService) Get() Settings {
	c := config.GetConfig()
	return Settings{
		PlaneBaseURL: c.Plane.BaseURL, PlaneAppURL: plane.AppURL(), PlaneClientID: c.Plane.ClientID,
		PlaneSecretSet: c.Plane.ClientSecret != "", PlaneWorkspace: c.Plane.Workspace,
		PlaneRedirectPort: c.Plane.RedirectPort, PlaneConnected: s.plane.client.Connected(),
		ConnectedSlug: s.plane.client.Workspace(), DevtoKeySet: c.DevTo.APIKey != "",
		SyncInterval: c.Sync.IntervalSeconds, AgentName: c.Agent.Name, AgentLabel: c.Agent.Label,
		ConfigPath: config.Path(), PostsDir: s.posts.store.Dir,
		RedirectURI: "http://127.0.0.1:" + strconv.Itoa(c.Plane.RedirectPort) + "/oauth/callback",
	}
}

func (s *SettingsService) Save(in SettingsInput) (Settings, error) {
	err := config.Update(func(c *config.Config) {
		c.Plane.BaseURL = in.PlaneBaseURL
		c.Plane.AppURL = in.PlaneAppURL
		if in.PlaneAppURL == plane.AppURL() {
			// Leave it derived unless the user actually changed it.
			c.Plane.AppURL = ""
		}
		c.Plane.ClientID = in.PlaneClientID
		if in.PlaneSecret != "" {
			c.Plane.ClientSecret = in.PlaneSecret
		}
		c.Plane.Workspace = in.PlaneWorkspace
		if in.PlaneRedirectPort > 0 {
			c.Plane.RedirectPort = in.PlaneRedirectPort
		}
		if in.DevtoKey != "" {
			c.DevTo.APIKey = in.DevtoKey
		}
		if in.SyncInterval >= 30 {
			c.Sync.IntervalSeconds = in.SyncInterval
		}
		c.Agent.Name = in.AgentName
		c.Agent.Label = in.AgentLabel
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
