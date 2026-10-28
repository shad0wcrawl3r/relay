package plane

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
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
	// PKCE (S256): Plane is built on django-oauth-toolkit, which can require it.
	verifier := randomHex(32)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", cfg.Plane.RedirectPort))
	if err != nil {
		return nil, fmt.Errorf("could not listen for the OAuth redirect on port %d: %w", cfg.Plane.RedirectPort, err)
	}

	type result struct {
		code string
		err  error
	}
	done := make(chan result, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		res := result{code: q.Get("code")}
		switch {
		case q.Get("error") != "":
			msg := q.Get("error")
			if d := q.Get("error_description"); d != "" {
				msg += ": " + d
			}
			res.err = fmt.Errorf("Plane refused the request (%s)", msg)
		case q.Get("state") != state:
			res.err = errors.New("OAuth state mismatch")
		case res.code == "":
			res.err = errors.New("no authorization code in redirect")
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if res.err != nil {
			fmt.Fprint(w, callbackPage("Relay couldn't connect to Plane", html.EscapeString(res.err.Error())+"<br>You can close this tab and try again from Relay."))
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
		"client_id":             {cfg.Plane.ClientID},
		"response_type":         {"code"},
		"redirect_uri":          {redirectURI(cfg)},
		"state":                 {state},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}
	if cfg.Plane.Scope != "" {
		q.Set("scope", cfg.Plane.Scope)
	}
	// Not secret, and the first thing to compare when Plane answers 400.
	log.Printf("plane: opening consent page; redirect_uri=%s scope=%q", redirectURI(cfg), cfg.Plane.Scope)
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
		"redirect_uri":  {redirectURI(cfg)},
		"code_verifier": {verifier},
	})
	if err != nil {
		return nil, err
	}
	// The user-token redirect carries only code and state, so the workspace
	// comes from the installation list the token can see.
	tok.Workspace = cfg.Plane.Workspace
	if tok.Workspace == "" {
		slug, id, err := installation(ctx, cfg, tok.AccessToken)
		if err != nil {
			return nil, fmt.Errorf("connected, but couldn't determine the workspace (%v); set the workspace slug in Settings", err)
		}
		tok.Workspace, tok.InstallationID = slug, id
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

// exchange calls the token endpoint. Client credentials go in an HTTP Basic
// header first (what Plane's docs and MCP server use); if Plane rejects that
// with invalid_client, it retries with them in the form body. Client
// authentication runs before the code is checked, so the retry is safe.
func exchange(ctx context.Context, cfg *config.Config, grant url.Values) (*Token, error) {
	id := strings.TrimSpace(cfg.Plane.ClientID)
	secret := strings.TrimSpace(cfg.Plane.ClientSecret)
	tok, err := tokenRequest(ctx, cfg, grant, func(req *http.Request, form url.Values) {
		// RFC 6749 §2.3.1: form-encode each part before Basic encoding.
		req.SetBasicAuth(url.QueryEscape(id), url.QueryEscape(secret))
	})
	var te *tokenError
	if !errors.As(err, &te) || te.code != "invalid_client" {
		return tok, err
	}
	return tokenRequest(ctx, cfg, grant, func(_ *http.Request, form url.Values) {
		form.Set("client_id", id)
		form.Set("client_secret", secret)
	})
}

type tokenError struct {
	status, code, desc string
}

func (e *tokenError) Error() string {
	if e.desc != "" {
		return fmt.Sprintf("token request failed: %s (%s)", e.desc, e.code)
	}
	return fmt.Sprintf("token request failed: %s %s", e.status, e.code)
}

func tokenRequest(ctx context.Context, cfg *config.Config, grant url.Values, authn func(*http.Request, url.Values)) (*Token, error) {
	form := url.Values{}
	for k, v := range grant {
		form[k] = v
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL(cfg)+"/auth/o/token/", nil)
	if err != nil {
		return nil, err
	}
	authn(req, form)
	body := form.Encode()
	req.Body = io.NopCloser(strings.NewReader(body))
	req.ContentLength = int64(len(body))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var tr tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return nil, &tokenError{status: resp.Status}
	}
	if resp.StatusCode >= 300 || tr.AccessToken == "" {
		return nil, &tokenError{status: resp.Status, code: tr.Error, desc: tr.ErrorDesc}
	}
	t := &Token{AccessToken: tr.AccessToken, RefreshToken: tr.RefreshToken}
	if tr.ExpiresIn > 0 {
		t.Expiry = time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second)
	}
	return t, nil
}

// installation returns the workspace slug and installation id for the app
// installation visible to the token.
func installation(ctx context.Context, cfg *config.Config, access string) (slug, id string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL(cfg)+"/auth/o/app-installation/", nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+access)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("app-installation: %s", resp.Status)
	}
	var body json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", "", err
	}
	type inst struct {
		ID              string `json:"id"`
		WorkspaceDetail struct {
			Slug string `json:"slug"`
		} `json:"workspace_detail"`
	}
	// Documented as a list; accept a single object too.
	var many []inst
	if json.Unmarshal(body, &many) == nil && len(many) > 0 && many[0].WorkspaceDetail.Slug != "" {
		return many[0].WorkspaceDetail.Slug, many[0].ID, nil
	}
	var one inst
	if json.Unmarshal(body, &one) == nil && one.WorkspaceDetail.Slug != "" {
		return one.WorkspaceDetail.Slug, one.ID, nil
	}
	return "", "", errors.New("app-installation: no workspace in response")
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
