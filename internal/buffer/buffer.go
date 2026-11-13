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
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/keychain"
	"github.com/shad0wcrawl3r/relay/internal/logs"
)

var log = logs.For("buffer")

// Keychain accounts for the sign-in. Dev builds keep their own, so running
// wails3 dev beside the installed app never spends its refresh token.
const (
	KeychainAccount    = "buffer-oauth"
	DevKeychainAccount = "buffer-oauth-dev"
)

// keyringUser is the account in use; main switches dev builds to DevKeychainAccount
// before the first call.
var keyringUser = KeychainAccount

// UseAccount sets the keychain account the sign-in lives under.
func UseAccount(name string) { keyringUser = name }

const (
	keyringService = "relay"

	// DefaultClientID identifies Relay's public OAuth client. It isn't a
	// secret: desktop apps sign in with PKCE alone. Users can sign in with
	// their own Buffer app instead (Settings → Buffer, Client.Credentials),
	// for example when Relay's is rate limited.
	DefaultClientID = "rN1FEFOV2TyYR2anIMmuAnYwUGwxWLyVwDhfOL5XtU6"

	// RedirectURI must match the App Client exactly and be https, so Buffer
	// sends users to this page, which forwards to the loopback listener. A
	// custom app registers the same one: the page forwards any client's
	// sign-in, and the code is useless without this Relay's PKCE verifier.
	RedirectURI = "https://relay.shadowcrawler.dev/oauth/callback"

	// Scope is what Relay asks Buffer for; a custom app must allow it.
	Scope = "posts:read posts:write ideas:read ideas:write account:read offline_access"

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
	// ClientID is the app the token was issued to; a refresh must use the
	// same one. Empty (sign-ins before custom apps) means DefaultClientID.
	ClientID string `json:"client_id,omitempty"`
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

// RateLimited means Buffer asked Relay to wait. Until is when it may ask again.
type RateLimited struct{ Until time.Time }

func (e *RateLimited) Error() string {
	secs := int(time.Until(e.Until).Round(time.Second).Seconds())
	if secs < 1 {
		secs = 1
	}
	return fmt.Sprintf("Buffer's rate limit was reached; try again in %d seconds", secs)
}

// defaultRetryAfter is the wait when Buffer's 429 doesn't say.
const defaultRetryAfter = time.Minute

// retryAfter reads a Retry-After header: seconds, or an HTTP date.
func retryAfter(v string, now time.Time) time.Time {
	v = strings.TrimSpace(v)
	if n, err := strconv.Atoi(v); err == nil && n >= 0 {
		return now.Add(time.Duration(n) * time.Second)
	}
	if t, err := http.ParseTime(v); err == nil && t.After(now) {
		return t
	}
	return now.Add(defaultRetryAfter)
}

// RateLimit reports whether Buffer is making Relay wait, and until when.
func (c *Client) RateLimit() (time.Time, bool) {
	c.limitMu.Lock()
	defer c.limitMu.Unlock()
	return c.limitedUntil, time.Now().Before(c.limitedUntil)
}

type Client struct {
	authURL, tokenURL, apiURL string
	http                      *http.Client

	// mu also spans the refresh request: a refresh token works once, and
	// reusing one revokes the whole grant.
	mu    sync.Mutex
	token *Token

	signIn sync.Mutex

	// limitedUntil is when Buffer will take requests again after a 429.
	// Until then Relay doesn't ask: every request would only extend the wait.
	limitMu      sync.Mutex
	limitedUntil time.Time

	// OnSignOut runs when Buffer ends the sign-in (revoked access or a
	// refused refresh), not when the user disconnects.
	OnSignOut func()

	// Credentials returns the user's own Buffer app, or "" for Relay's.
	// The secret is optional: Buffer apps can sign in with PKCE alone.
	Credentials func() (clientID, secret string)
}

// app is the Buffer app new sign-ins use.
func (c *Client) app() (id, secret string) {
	if c.Credentials != nil {
		if id, secret = c.Credentials(); strings.TrimSpace(id) != "" {
			return strings.TrimSpace(id), strings.TrimSpace(secret)
		}
	}
	return DefaultClientID, ""
}

// appFor is the app a token belongs to, with its secret when it's the
// user's current one.
func (c *Client) appFor(t *Token) (id, secret string) {
	id = t.ClientID
	if id == "" {
		id = DefaultClientID
	}
	if cur, s := c.app(); cur == id {
		return id, s
	}
	return id, ""
}

// ClientID is the app the stored sign-in belongs to, "" when signed out.
func (c *Client) ClientID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := c.load()
	if t == nil {
		return ""
	}
	if t.ClientID == "" {
		return DefaultClientID
	}
	return t.ClientID
}

// ResetRateLimit forgets a 429's wait. Buffer limits each app on its own,
// so a different app starts fresh.
func (c *Client) ResetRateLimit() {
	c.limitMu.Lock()
	c.limitedUntil = time.Time{}
	c.limitMu.Unlock()
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
	return c.reload()
}

// reload reads the sign-in from the keychain, skipping the copy in memory:
// another Relay (a second build, or the one an update replaced) may have
// rotated it since. Callers hold mu.
func (c *Client) reload() *Token {
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
	if fresh(t) {
		return t, nil
	}
	// Another Relay may have refreshed already. Its token is in the keychain,
	// and ours is spent: using it would make Buffer revoke the grant.
	if s := c.reload(); s != nil && s.RefreshToken != t.RefreshToken {
		t = s
		if fresh(t) {
			return t, nil
		}
	} else if s == nil {
		// Signed out elsewhere (or cleared): don't revive the old token.
		c.token = nil
		return nil, ErrNotConnected
	}
	id, secret := c.appFor(t)
	next, err := c.redeem(ctx, id, secret, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {t.RefreshToken},
	})
	var refused *oauthError
	if errors.As(err, &refused) {
		// Refused because another Relay rotated it in the meantime: keep theirs.
		if s := c.reload(); s != nil && s.RefreshToken != t.RefreshToken {
			log.Info("refresh refused, using the token another instance saved")
			return s, nil
		}
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

func fresh(t *Token) bool { return time.Now().Before(t.Expiry.Add(-refreshSkew)) }

// replaced reports whether the keychain holds a different access token than
// bearer, which means another Relay refreshed the sign-in. The client adopts it.
func (c *Client) replaced(bearer string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	s := c.reload()
	return s != nil && s.AccessToken != bearer
}

// errReplaced is a 401 for a token another Relay has since replaced.
var errReplaced = errors.New("buffer: token replaced by another instance")

func (c *Client) redeem(ctx context.Context, clientID, secret string, form url.Values) (*Token, error) {
	form.Set("client_id", clientID)
	if secret != "" {
		form.Set("client_secret", secret)
	}
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
		ClientID:     clientID,
	}, nil
}

// query runs a GraphQL query and decodes its data into out.
func (c *Client) query(ctx context.Context, query string, out any) error {
	return c.queryVars(ctx, query, nil, out)
}

// queryVars runs a GraphQL query with variables, so user text never has to
// be spliced into the query itself.
func (c *Client) queryVars(ctx context.Context, query string, vars map[string]any, out any) error {
	if until, limited := c.RateLimit(); limited {
		return &RateLimited{Until: until}
	}
	for try := 0; ; try++ {
		t, err := c.valid(ctx)
		if err != nil {
			return err
		}
		err = c.send(ctx, t.AccessToken, false, query, vars, out)
		if !errors.Is(err, errReplaced) || try > 0 {
			return err
		}
	}
}

// ErrBadKey is a personal API key Buffer refused.
var ErrBadKey = errors.New("Buffer refused the API key")

// queryWithKey runs a query with a personal API key instead of the OAuth
// token. A 401 means the key is wrong, never that the user signed out.
func (c *Client) queryWithKey(ctx context.Context, key, query string, vars map[string]any, out any) error {
	if until, limited := c.RateLimit(); limited {
		return &RateLimited{Until: until}
	}
	return c.send(ctx, key, true, query, vars, out)
}

func (c *Client) send(ctx context.Context, bearer string, personal bool, query string, vars map[string]any, out any) error {
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
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach Buffer: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		if personal {
			return ErrBadKey
		}
		// A token another Relay already rotated away: retry with theirs.
		if c.replaced(bearer) {
			return errReplaced
		}
		// Buffer answers 401 once the user revokes access.
		log.Warn("access revoked, signing out")
		_ = c.Disconnect()
		c.signedOut()
		return ErrNotConnected
	case http.StatusTooManyRequests:
		until := retryAfter(resp.Header.Get("Retry-After"), time.Now())
		c.limitMu.Lock()
		if until.After(c.limitedUntil) {
			c.limitedUntil = until
		}
		c.limitMu.Unlock()
		log.Warn("rate limited", "retry_in", time.Until(until).Round(time.Second).String())
		return &RateLimited{Until: until}
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
