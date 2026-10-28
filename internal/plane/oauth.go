package plane

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/zalando/go-keyring"
)

const keyringService = "relay"
const keyringUser = "plane-oauth"

// Token is the user token from Plane's authorization-code flow. It lives in
// the OS keychain, never in config.toml.
type Token struct {
	AccessToken    string    `json:"access_token"`
	RefreshToken   string    `json:"refresh_token"`
	Expiry         time.Time `json:"expiry"`
	Workspace      string    `json:"workspace"`
	InstallationID string    `json:"installation_id"`
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

var ErrNotConnected = errors.New("plane: not connected")

type auth struct {
	mu    sync.Mutex
	token *Token
}

func (a *auth) load() (*Token, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.token != nil {
		return a.token, nil
	}
	raw, err := keyring.Get(keyringService, keyringUser)
	if err != nil {
		return nil, ErrNotConnected
	}
	var t Token
	if err := json.Unmarshal([]byte(raw), &t); err != nil {
		return nil, ErrNotConnected
	}
	a.token = &t
	return a.token, nil
}

func (a *auth) store(t *Token) error {
	raw, err := json.Marshal(t)
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.token = t
	return keyring.Set(keyringService, keyringUser, string(raw))
}

func (a *auth) clear() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.token = nil
	err := keyring.Delete(keyringService, keyringUser)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}

func redirectURI(cfg *config.Config) string {
	return fmt.Sprintf("http://127.0.0.1:%d/oauth/callback", cfg.Plane.RedirectPort)
}

func baseURL(cfg *config.Config) string {
	return strings.TrimRight(cfg.Plane.BaseURL, "/")
}

// authorize runs the authorization-code flow: it opens Plane's consent page
// and waits on a loopback listener for the redirect.
func (a *auth) authorize(ctx context.Context, openURL func(string)) (*Token, error) {
	cfg := config.GetConfig()
	if cfg.Plane.ClientID == "" || cfg.Plane.ClientSecret == "" {
		return nil, errors.New("set the Plane client ID and secret in Settings first")
	}
	state := randomHex(16)
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", cfg.Plane.RedirectPort))
	if err != nil {
		return nil, fmt.Errorf("could not listen for the OAuth redirect on port %d: %w", cfg.Plane.RedirectPort, err)
	}

	type result struct {
		code, installation string
		err                error
	}
	done := make(chan result, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		res := result{code: q.Get("code"), installation: q.Get("app_installation_id")}
		switch {
		case q.Get("state") != state:
			res.err = errors.New("OAuth state mismatch")
		case q.Get("error") != "":
			res.err = fmt.Errorf("Plane denied access: %s", q.Get("error"))
		case res.code == "":
			res.err = errors.New("no authorization code in redirect")
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if res.err != nil {
			fmt.Fprint(w, callbackPage("Relay couldn't connect to Plane", "You can close this tab and try again from Relay."))
		} else {
			fmt.Fprint(w, callbackPage("Relay is connected to Plane", "You can close this tab and return to Relay."))
		}
		select {
		case done <- res:
		default:
		}
	})
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go srv.Serve(ln)
	defer srv.Close()

	q := url.Values{
		"client_id":     {cfg.Plane.ClientID},
		"response_type": {"code"},
		"redirect_uri":  {redirectURI(cfg)},
		"state":         {state},
	}
	if cfg.Plane.Scope != "" {
		q.Set("scope", cfg.Plane.Scope)
	}
	openURL(baseURL(cfg) + "/auth/o/authorize-app/?" + q.Encode())

	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	var res result
	select {
	case res = <-done:
	case <-ctx.Done():
		return nil, errors.New("timed out waiting for Plane authorization")
	}
	if res.err != nil {
		return nil, res.err
	}

	tok, err := exchange(ctx, cfg, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {res.code},
		"client_id":     {cfg.Plane.ClientID},
		"client_secret": {cfg.Plane.ClientSecret},
		"redirect_uri":  {redirectURI(cfg)},
	})
	if err != nil {
		return nil, err
	}
	tok.InstallationID = res.installation
	tok.Workspace = cfg.Plane.Workspace
	if res.installation != "" {
		if slug, err := installationWorkspace(ctx, cfg, tok.AccessToken, res.installation); err == nil && slug != "" {
			tok.Workspace = slug
		}
	}
	if tok.Workspace == "" {
		return nil, errors.New("connected, but couldn't determine the workspace; set the workspace slug in Settings")
	}
	if err := a.store(tok); err != nil {
		return nil, fmt.Errorf("could not save token to the keychain: %w", err)
	}
	return tok, nil
}

// valid returns a non-expired token, refreshing it when needed.
func (a *auth) valid(ctx context.Context) (*Token, error) {
	t, err := a.load()
	if err != nil {
		return nil, err
	}
	if t.Expiry.IsZero() || time.Until(t.Expiry) > time.Minute {
		return t, nil
	}
	return a.refresh(ctx, t)
}

func (a *auth) refresh(ctx context.Context, t *Token) (*Token, error) {
	if t.RefreshToken == "" {
		return nil, ErrNotConnected
	}
	cfg := config.GetConfig()
	next, err := exchange(ctx, cfg, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {t.RefreshToken},
		"client_id":     {cfg.Plane.ClientID},
		"client_secret": {cfg.Plane.ClientSecret},
	})
	if err != nil {
		return nil, fmt.Errorf("%w: refresh failed: %v", ErrNotConnected, err)
	}
	if next.RefreshToken == "" {
		next.RefreshToken = t.RefreshToken
	}
	next.Workspace, next.InstallationID = t.Workspace, t.InstallationID
	if err := a.store(next); err != nil {
		return nil, err
	}
	return next, nil
}

func exchange(ctx context.Context, cfg *config.Config, form url.Values) (*Token, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL(cfg)+"/auth/o/token/", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var tr tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return nil, fmt.Errorf("token endpoint returned %s", resp.Status)
	}
	if resp.StatusCode >= 300 || tr.AccessToken == "" {
		if tr.ErrorDesc != "" {
			return nil, fmt.Errorf("token request failed: %s", tr.ErrorDesc)
		}
		return nil, fmt.Errorf("token request failed: %s %s", resp.Status, tr.Error)
	}
	t := &Token{AccessToken: tr.AccessToken, RefreshToken: tr.RefreshToken}
	if tr.ExpiresIn > 0 {
		t.Expiry = time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second)
	}
	return t, nil
}

func installationWorkspace(ctx context.Context, cfg *config.Config, access, id string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL(cfg)+"/auth/o/app-installation/?id="+url.QueryEscape(id), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+access)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("app-installation: %s", resp.Status)
	}
	var body json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	// The endpoint has returned both an object and a one-element list.
	type inst struct {
		WorkspaceDetail struct {
			Slug string `json:"slug"`
		} `json:"workspace_detail"`
	}
	var one inst
	if json.Unmarshal(body, &one) == nil && one.WorkspaceDetail.Slug != "" {
		return one.WorkspaceDetail.Slug, nil
	}
	var many []inst
	if json.Unmarshal(body, &many) == nil && len(many) > 0 {
		return many[0].WorkspaceDetail.Slug, nil
	}
	return "", errors.New("app-installation: no workspace in response")
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func callbackPage(title, body string) string {
	return `<!doctype html><meta charset="utf-8"><title>Relay</title>` +
		`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#09090b;color:#e4e4e7;font-family:system-ui,sans-serif">` +
		`<div style="text-align:center"><h1 style="font-size:18px;font-weight:600;color:#fafafa">` + title + `</h1>` +
		`<p style="color:#a1a1aa;font-size:14px">` + body + `</p></div></body>`
}
