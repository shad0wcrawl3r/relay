package plane

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

func TestBotTokenMatchesSample(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		user, pass, ok := r.BasicAuth()
		if !ok || user != "id+1" || pass != "s/cret" {
			t.Errorf("basic auth = %q %q %v", user, pass, ok)
		}
		if _, ok := r.PostForm["client_secret"]; ok {
			t.Error("secret leaked into the form body")
		}
		f := r.PostForm
		if f.Get("grant_type") != "client_credentials" || f.Get("app_installation_id") != "inst-1" || f.Get("scope") != "read write" {
			t.Errorf("form = %v", f)
		}
		fmt.Fprint(w, `{"access_token":"bot","expires_in":3600}`)
	}))
	defer srv.Close()
	config.Override(func(c *config.Config) {
		c.Plane.BaseURL = srv.URL
		c.Plane.ClientID, c.Plane.ClientSecret = " id+1 ", "s/cret"
		c.Plane.Scope = "read write"
	})
	tok, err := botToken(context.Background(), config.GetConfig(), "inst-1")
	if err != nil {
		t.Fatal(err)
	}
	if tok.AccessToken != "bot" || tok.InstallationID != "inst-1" || tok.Expiry.IsZero() {
		t.Errorf("token = %+v", tok)
	}
}

func TestRefreshRemintsBotToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.PostForm.Get("app_installation_id") != "inst-1" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		fmt.Fprint(w, `{"access_token":"fresh","expires_in":60}`)
	}))
	defer srv.Close()
	config.Override(func(c *config.Config) {
		c.Plane.BaseURL = srv.URL
		c.Plane.ClientID, c.Plane.ClientSecret = "id", "secret"
	})
	// refresh itself writes to the keychain, so test the re-mint it relies on.
	tok, err := botToken(context.Background(), config.GetConfig(), "inst-1")
	if err != nil || tok.AccessToken != "fresh" {
		t.Fatalf("tok=%+v err=%v", tok, err)
	}
	if _, err := (&auth{}).refresh(context.Background(), &Token{}); err != ErrNotConnected {
		t.Errorf("refresh without installation = %v", err)
	}
}

func TestInstallationReadsWorkspace(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer bot" || r.URL.Query().Get("id") != "inst-1" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		fmt.Fprint(w, `[{"id":"inst-1","workspace_detail":{"slug":"my-ws"}}]`)
	}))
	defer srv.Close()
	config.Override(func(c *config.Config) { c.Plane.BaseURL = srv.URL })
	slug, id, err := installation(context.Background(), config.GetConfig(), "bot", "inst-1")
	if err != nil || slug != "my-ws" || id != "inst-1" {
		t.Errorf("slug=%q id=%q err=%v", slug, id, err)
	}
}
