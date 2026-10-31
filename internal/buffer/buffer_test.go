package buffer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/zalando/go-keyring"
)

func TestMain(m *testing.M) {
	keyring.MockInit()
	os.Exit(m.Run())
}

// forwardState mirrors STATE in site/oauth/forward.js.
var forwardState = regexp.MustCompile(`^([0-9]{4,5})\.[A-Za-z0-9_-]{16,128}$`)

func newClient(t *testing.T, token, api http.HandlerFunc) *Client {
	t.Helper()
	keyring.MockInit()
	tokens := httptest.NewServer(token)
	graphql := httptest.NewServer(api)
	t.Cleanup(tokens.Close)
	t.Cleanup(graphql.Close)
	c := New()
	c.authURL, c.tokenURL, c.apiURL = "https://auth.example/auth", tokens.URL, graphql.URL
	return c
}

// redirect acts as the hosted page: it sends params to the loopback listener
// named by the state in the consent URL.
// It runs on its own goroutine, so failures use t.Error and return.
func redirect(t *testing.T, consent string, extra url.Values) {
	t.Helper()
	u, err := url.Parse(consent)
	if err != nil {
		t.Error(err)
		return
	}
	state := u.Query().Get("state")
	m := forwardState.FindStringSubmatch(state)
	if m == nil {
		t.Errorf("state %q would be refused by the hosted page", state)
		return
	}
	q := url.Values{"state": {state}}
	for k, v := range extra {
		q[k] = v
	}
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%s/oauth/callback?%s", m[1], q.Encode()))
	if err != nil {
		t.Error(err)
		return
	}
	resp.Body.Close()
}

func tokenJSON(w http.ResponseWriter, access, refresh string, expires int) {
	json.NewEncoder(w).Encode(map[string]any{"access_token": access, "refresh_token": refresh, "expires_in": expires})
}

func stored(t *testing.T) Token {
	t.Helper()
	raw, err := keyring.Get(keyringService, keyringUser)
	if err != nil {
		t.Fatal(err)
	}
	var tok Token
	if err := json.Unmarshal([]byte(raw), &tok); err != nil {
		t.Fatal(err)
	}
	return tok
}

func TestConnectUsesPKCEWithoutASecret(t *testing.T) {
	paramsCh := make(chan url.Values, 1)
	var params url.Values
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		f := r.PostForm
		if _, ok := f["client_secret"]; ok {
			t.Error("a public client must not send a secret")
		}
		if f.Get("grant_type") != "authorization_code" || f.Get("code") != "the-code" || f.Get("client_id") != clientID || f.Get("redirect_uri") != redirectURI {
			t.Errorf("form = %v", f)
		}
		params = <-paramsCh
		if got := challengeFor(f.Get("code_verifier")); got != params.Get("code_challenge") {
			t.Errorf("verifier doesn't match the challenge: %q", got)
		}
		tokenJSON(w, "access", "refresh", 3600)
	}, nil)

	err := c.Connect(context.Background(), func(consent string) {
		u, _ := url.Parse(consent)
		paramsCh <- u.Query()
		go redirect(t, consent, url.Values{"code": {"the-code"}})
	})
	if err != nil {
		t.Fatal(err)
	}
	if params.Get("code_challenge_method") != "S256" || params.Get("redirect_uri") != redirectURI || !strings.Contains(params.Get("scope"), "offline_access") {
		t.Errorf("consent params = %v", params)
	}
	if got := stored(t); got.AccessToken != "access" || got.RefreshToken != "refresh" || got.Expiry.Before(time.Now()) {
		t.Errorf("stored = %+v", got)
	}
	if !c.Connected() {
		t.Error("not connected after sign-in")
	}
}

func TestConnectIgnoresAWrongState(t *testing.T) {
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.PostForm.Get("code") != "real" {
			t.Errorf("code = %q", r.PostForm.Get("code"))
		}
		tokenJSON(w, "access", "refresh", 3600)
	}, nil)

	err := c.Connect(context.Background(), func(consent string) {
		go func() {
			u, _ := url.Parse(consent)
			m := forwardState.FindStringSubmatch(u.Query().Get("state"))
			resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%s/oauth/callback?code=forged&state=%s.wrong", m[1], m[1]))
			if err != nil {
				t.Error(err)
				return
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("forged redirect got HTTP %d", resp.StatusCode)
			}
			redirect(t, consent, url.Values{"code": {"real"}})
		}()
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestConnectReportsARefusal(t *testing.T) {
	c := newClient(t, func(http.ResponseWriter, *http.Request) { t.Error("no token request expected") }, nil)
	err := c.Connect(context.Background(), func(consent string) {
		go redirect(t, consent, url.Values{"error": {"access_denied"}})
	})
	var refused *oauthError
	if !errors.As(err, &refused) || refused.code != "access_denied" {
		t.Fatalf("err = %v", err)
	}
	if c.Connected() {
		t.Error("connected after a refusal")
	}
}

func TestConnectHonoursCancellation(t *testing.T) {
	c := newClient(t, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	if err := c.Connect(ctx, func(string) { cancel() }); err == nil {
		t.Fatal("expected an error")
	}
}

func seed(t *testing.T, c *Client, tok Token) {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.store(&tok); err != nil {
		t.Fatal(err)
	}
	c.token = nil
}

func TestRefreshRotatesAndSavesOnce(t *testing.T) {
	var calls atomic.Int32
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_ = r.ParseForm()
		if r.PostForm.Get("refresh_token") != "old" || r.PostForm.Get("grant_type") != "refresh_token" {
			t.Errorf("form = %v", r.PostForm)
		}
		time.Sleep(20 * time.Millisecond)
		tokenJSON(w, "new-access", "new-refresh", 3600)
	}, nil)
	seed(t, c, Token{AccessToken: "stale", RefreshToken: "old", Expiry: time.Now().Add(-time.Hour)})

	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			tok, err := c.valid(context.Background())
			if err != nil || tok.AccessToken != "new-access" {
				t.Errorf("valid = %+v, %v", tok, err)
			}
		})
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Errorf("refreshed %d times; a second use would revoke the grant", calls.Load())
	}
	if got := stored(t); got.RefreshToken != "new-refresh" {
		t.Errorf("stored = %+v", got)
	}
}

func TestRefreshKeepsTheTokenOnANetworkFailure(t *testing.T) {
	c := newClient(t, func(http.ResponseWriter, *http.Request) {}, nil)
	seed(t, c, Token{AccessToken: "stale", RefreshToken: "old", Expiry: time.Now().Add(-time.Hour)})
	c.tokenURL = "http://127.0.0.1:1/token"
	if _, err := c.valid(context.Background()); err == nil || errors.Is(err, ErrNotConnected) {
		t.Fatalf("err = %v", err)
	}
	if got := stored(t); got.RefreshToken != "old" {
		t.Errorf("stored = %+v", got)
	}
}

func TestRefusedRefreshAsksForSignIn(t *testing.T) {
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":"invalid_grant"}`)
	}, nil)
	seed(t, c, Token{RefreshToken: "spent", Expiry: time.Now().Add(-time.Hour)})
	if _, err := c.valid(context.Background()); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("err = %v", err)
	}
	if c.Connected() {
		t.Error("spent token kept")
	}
}

func TestAccount(t *testing.T) {
	c := newClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer good" {
			t.Errorf("auth = %q", r.Header.Get("Authorization"))
		}
		fmt.Fprint(w, `{"data":{"account":{"name":"A","email":"a@example.com","organizations":[{"id":"o1","name":"Org"}]}}}`)
	})
	seed(t, c, Token{AccessToken: "good", Expiry: time.Now().Add(time.Hour)})
	a, err := c.Account(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if a.Name != "A" || len(a.Organizations) != 1 || a.Organizations[0].ID != "o1" {
		t.Errorf("account = %+v", a)
	}
}

func TestRevokedAccessDisconnects(t *testing.T) {
	c := newClient(t, nil, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) })
	seed(t, c, Token{AccessToken: "revoked", Expiry: time.Now().Add(time.Hour)})
	if _, err := c.Account(context.Background()); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("err = %v", err)
	}
	if c.Connected() {
		t.Error("revoked token kept")
	}
}

func TestRateLimitSaysWhenToRetry(t *testing.T) {
	c := newClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "42")
		w.WriteHeader(http.StatusTooManyRequests)
	})
	seed(t, c, Token{AccessToken: "ok", Expiry: time.Now().Add(time.Hour)})
	if _, err := c.Account(context.Background()); err == nil || !strings.Contains(err.Error(), "42") {
		t.Fatalf("err = %v", err)
	}
}

func TestGraphQLErrorsSurface(t *testing.T) {
	c := newClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"errors":[{"message":"nope"}]}`)
	})
	seed(t, c, Token{AccessToken: "ok", Expiry: time.Now().Add(time.Hour)})
	if _, err := c.Account(context.Background()); err == nil || !strings.Contains(err.Error(), "nope") {
		t.Fatalf("err = %v", err)
	}
}
