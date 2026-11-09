// Package buffer signs in to Buffer with OAuth and talks to its GraphQL API.
package buffer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/keychain"
	"github.com/shad0wcrawl3r/relay/internal/logs"
)

var log = logs.For("buffer")

const (
	keyringService = "relay"
	keyringUser    = "buffer-oauth"

	// clientID identifies Relay's public OAuth client. It isn't a secret:
	// desktop apps sign in with PKCE alone.
	clientID = "rN1FEFOV2TyYR2anIMmuAnYwUGwxWLyVwDhfOL5XtU6"

	// redirectURI must match the App Client exactly and be https, so Buffer
	// sends users to this page, which forwards to the loopback listener.
	redirectURI = "https://relay.shadowcrawler.dev/oauth/callback"

	scope = "posts:read posts:write ideas:read ideas:write account:read offline_access"

	// refreshSkew renews a token this long before Buffer would reject it.
	refreshSkew = time.Minute
)

// ErrNotConnected means the user has to sign in, either for the first time or
// because Buffer revoked the grant.
var ErrNotConnected = errors.New("buffer: not connected")

// Token lives in the OS keychain, never in config.toml.
type Token struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	Expiry       time.Time `json:"expiry"`
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

// oauthError is a refusal from the token endpoint, as opposed to a failure to
// reach it.
type oauthError struct{ code, desc string }

func (e *oauthError) Error() string {
	if e.desc != "" {
		return fmt.Sprintf("Buffer refused the request (%s: %s)", e.code, e.desc)
	}
	return fmt.Sprintf("Buffer refused the request (%s)", e.code)
}

type Client struct {
	authURL, tokenURL, apiURL string
	http                      *http.Client

	// mu also spans the refresh request: a refresh token works once, and
	// reusing one revokes the whole grant.
	mu    sync.Mutex
	token *Token

	signIn sync.Mutex

	// OnSignOut runs when Buffer ends the sign-in (revoked access or a
	// refused refresh), not when the user disconnects.
	OnSignOut func()
}

func (c *Client) signedOut() {
	if c.OnSignOut != nil {
		go c.OnSignOut()
	}
}

func New() *Client {
	return &Client{
		authURL:  "https://auth.buffer.com/auth",
		tokenURL: "https://auth.buffer.com/token",
		apiURL:   "https://api.buffer.com",
		http:     &http.Client{Timeout: 30 * time.Second, Transport: logs.Transport("buffer", nil)},
	}
}

// Connected reports whether a sign-in is stored. It makes no network calls.
func (c *Client) Connected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.load() != nil
}

// Disconnect forgets the local tokens.
func (c *Client) Disconnect() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.clear()
}

func (c *Client) load() *Token {
	if c.token != nil {
		return c.token
	}
	raw, err := keychain.Get(keyringService, keyringUser)
	if err != nil {
		return nil
	}
	var t Token
	if err := json.Unmarshal([]byte(raw), &t); err != nil {
		return nil
	}
	c.token = &t
	return c.token
}

func (c *Client) store(t *Token) error {
	raw, err := json.Marshal(t)
	if err != nil {
		return err
	}
	c.token = t
	return keychain.Set(keyringService, keyringUser, string(raw))
}

func (c *Client) clear() error {
	c.token = nil
	err := keychain.Delete(keyringService, keyringUser)
	if errors.Is(err, keychain.ErrNotFound) {
		return nil
	}
	return err
}

// valid returns a usable token, refreshing it when needed. The rotated token
// is saved before anything uses it, so a crash can't strand a spent one.
func (c *Client) valid(ctx context.Context) (*Token, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := c.load()
	if t == nil {
		return nil, ErrNotConnected
	}
	if time.Now().Before(t.Expiry.Add(-refreshSkew)) {
		return t, nil
	}
	next, err := c.redeem(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {t.RefreshToken},
	})
	var refused *oauthError
	if errors.As(err, &refused) {
		log.Warn("refresh refused, signing out", "error", err)
		_ = c.clear()
		c.signedOut()
		return nil, ErrNotConnected
	}
	if err != nil {
		log.Warn("refresh failed", "error", err)
		return nil, err
	}
	log.Debug("token refreshed", "expires", next.Expiry.Format(time.RFC3339))
	if next.RefreshToken == "" {
		next.RefreshToken = t.RefreshToken
	}
	if err := c.store(next); err != nil {
		// The old refresh token is spent, so keep this one in memory. The
		// next launch will need a new sign-in.
		log.Error("could not save the refreshed token", "error", err)
	}
	return next, nil
}

func (c *Client) redeem(ctx context.Context, form url.Values) (*Token, error) {
	form.Set("client_id", clientID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach Buffer: %w", err)
	}
	defer resp.Body.Close()
	var tr tokenResponse
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(body, &tr); err != nil {
		return nil, fmt.Errorf("unexpected reply from Buffer (HTTP %d)", resp.StatusCode)
	}
	if tr.Error != "" {
		return nil, &oauthError{tr.Error, tr.ErrorDesc}
	}
	if resp.StatusCode != http.StatusOK || tr.AccessToken == "" {
		return nil, fmt.Errorf("unexpected reply from Buffer (HTTP %d)", resp.StatusCode)
	}
	return &Token{
		AccessToken:  tr.AccessToken,
		RefreshToken: tr.RefreshToken,
		Expiry:       time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second),
	}, nil
}

// query runs a GraphQL query and decodes its data into out.
func (c *Client) query(ctx context.Context, query string, out any) error {
	return c.queryVars(ctx, query, nil, out)
}

// queryVars runs a GraphQL query with variables, so user text never has to
// be spliced into the query itself.
func (c *Client) queryVars(ctx context.Context, query string, vars map[string]any, out any) error {
	t, err := c.valid(ctx)
	if err != nil {
		return err
	}
	reqBody := map[string]any{"query": query}
	if vars != nil {
		reqBody["variables"] = vars
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+t.AccessToken)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach Buffer: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		// Buffer answers 401 once the user revokes access.
		log.Warn("access revoked, signing out")
		_ = c.Disconnect()
		c.signedOut()
		return ErrNotConnected
	case http.StatusTooManyRequests:
		return fmt.Errorf("Buffer's rate limit was reached; try again in %s seconds", resp.Header.Get("Retry-After"))
	}
	var body struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&body); err != nil {
		return fmt.Errorf("unexpected reply from Buffer (HTTP %d)", resp.StatusCode)
	}
	if len(body.Errors) > 0 {
		log.Warn("query failed", "error", body.Errors[0].Message)
		return fmt.Errorf("Buffer: %s", body.Errors[0].Message)
	}
	return json.Unmarshal(body.Data, out)
}

type Organization struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ChannelCount int    `json:"channelCount"`
	Limits       Limits `json:"limits"`
}

type Account struct {
	Name          string         `json:"name"`
	Email         string         `json:"email"`
	Organizations []Organization `json:"organizations"`
}

// Account returns the signed-in Buffer account.
func (c *Client) Account(ctx context.Context) (Account, error) {
	var data struct {
		Account Account `json:"account"`
	}
	err := c.query(ctx, `query { account { name email organizations { id name channelCount limits { channels scheduledPosts ideas tags } } } }`, &data)
	return data.Account, err
}
