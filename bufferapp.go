package main

import (
	"errors"
	"strings"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
)

// Buffer OAuth app: Relay's own by default, or one the user created in
// Buffer (Settings → Publishing → Buffer → OAuth app), for example when Relay's is rate
// limited. The client ID is in config.toml, the optional secret in the
// keychain. A custom app registers the same hosted redirect URI.

// BufferApp is the app Relay signs in to Buffer with.
type BufferApp struct {
	Custom    bool   `json:"custom"`
	ClientID  string `json:"clientId"`
	SecretSet bool   `json:"secretSet"`
	// RedirectURI is what the user's app must list as its callback.
	RedirectURI string `json:"redirectUri"`
	// Scopes are what the app must allow.
	Scopes []string `json:"scopes"`
	// SignedInWith is "relay", "custom" or "" (signed out).
	SignedInWith string `json:"signedInWith"`
}

// App reports which Buffer app is in use.
func (s *BufferService) App() BufferApp {
	c := config.GetConfig()
	a := BufferApp{Custom: c.Buffer.ClientID != "", ClientID: c.Buffer.ClientID, SecretSet: c.Buffer.ClientSecret != "", RedirectURI: buffer.RedirectURI, Scopes: strings.Fields(buffer.Scope)}
	switch id := s.client.ClientID(); {
	case id == "":
	case id == buffer.DefaultClientID:
		a.SignedInWith = "relay"
	default:
		a.SignedInWith = "custom"
	}
	return a
}

// SetApp switches to the user's own Buffer app; an empty clientID goes back
// to Relay's. A blank secret keeps the saved one for the same app. A sign-in
// made with another app is ended: its tokens only refresh with that app, and
// the point of switching is to stop using it. The user signs in again.
func (s *BufferService) SetApp(clientID, secret string) (BufferApp, error) {
	clientID, secret = strings.TrimSpace(clientID), strings.TrimSpace(secret)
	if strings.ContainsAny(clientID, " \t\n/?#&") || len(clientID) > 200 {
		return s.App(), errors.New("that doesn't look like a Buffer client ID")
	}
	prev := config.GetConfig().Buffer
	err := config.Update(func(c *config.Config) {
		c.Buffer.ClientID = clientID
		switch {
		case clientID == "":
			c.Buffer.ClientSecret = ""
		case secret != "":
			c.Buffer.ClientSecret = secret
		case clientID != prev.ClientID:
			// A secret belongs to its app.
			c.Buffer.ClientSecret = ""
		}
	})
	if err != nil {
		logs.For("buffer").Error("could not save the Buffer app", "error", err)
		return s.App(), err
	}
	want := clientID
	if want == "" {
		want = buffer.DefaultClientID
	}
	if have := s.client.ClientID(); have != "" && have != want {
		logs.For("buffer").Notice("Buffer app changed; signing out")
		if err := s.Disconnect(); err != nil {
			return s.App(), err
		}
	}
	// Each app has its own rate limit.
	s.client.ResetRateLimit()
	logs.For("buffer").Info("Buffer app saved", "custom", clientID != "")
	return s.App(), nil
}
