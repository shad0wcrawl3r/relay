package buffer

import (
	"context"
	"net/http"
	"net/url"
	"testing"
	"time"
)

// A user's own Buffer app signs in with its ID (and secret, when it has one),
// and the token remembers which app it came from.
func TestConnectWithACustomApp(t *testing.T) {
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.PostForm.Get("client_id") != "mine" || r.PostForm.Get("client_secret") != "shh" {
			t.Errorf("form = %v", r.PostForm)
		}
		tokenJSON(w, "access", "refresh", 3600)
	}, nil)
	c.Credentials = func() (string, string) { return " mine ", "shh" }

	err := c.Connect(context.Background(), func(consent string) {
		u, _ := url.Parse(consent)
		if u.Query().Get("client_id") != "mine" || u.Query().Get("client_secret") != "" {
			t.Errorf("consent params = %v", u.Query())
		}
		go redirect(t, consent, url.Values{"code": {"the-code"}})
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := stored(t); got.ClientID != "mine" {
		t.Errorf("stored client = %q", got.ClientID)
	}
	if c.ClientID() != "mine" {
		t.Errorf("ClientID() = %q", c.ClientID())
	}
}

// A refresh uses the app the token was issued to, even after the setting
// changed, and never sends another app's secret.
func TestRefreshUsesTheTokensApp(t *testing.T) {
	var form url.Values
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		form = r.PostForm
		tokenJSON(w, "new", "refresh-2", 3600)
	}, nil)
	c.Credentials = func() (string, string) { return "mine", "shh" }
	if err := c.store(&Token{AccessToken: "old", RefreshToken: "refresh-1", Expiry: time.Now().Add(-time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.valid(context.Background()); err != nil {
		t.Fatal(err)
	}
	if form.Get("client_id") != DefaultClientID || form.Get("client_secret") != "" {
		t.Errorf("refresh form = %v", form)
	}
	if got := stored(t); got.ClientID != DefaultClientID {
		t.Errorf("stored client = %q", got.ClientID)
	}
}

func TestResetRateLimit(t *testing.T) {
	c := New()
	c.limitedUntil = time.Now().Add(time.Hour)
	if _, limited := c.RateLimit(); !limited {
		t.Fatal("not limited")
	}
	c.ResetRateLimit()
	if _, limited := c.RateLimit(); limited {
		t.Error("still limited after reset")
	}
}
