package buffer

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"html"
	"net"
	"net/http"
	"net/url"
	"time"
)

const signInTimeout = 5 * time.Minute

func randomString() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func challengeFor(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// Connect runs the Authorization Code flow with PKCE. Buffer redirects to the
// hosted callback page, which forwards to the loopback listener here using the
// port in state as "<port>.<nonce>". Keep that format in step with
// site/oauth/forward.js in relay-status.
func (c *Client) Connect(ctx context.Context, openURL func(string)) error {
	if !c.signIn.TryLock() {
		return errors.New("a Buffer sign-in is already waiting in your browser")
	}
	defer c.signIn.Unlock()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("could not listen for the Buffer redirect: %w", err)
	}
	state := fmt.Sprintf("%d.%s", ln.Addr().(*net.TCPAddr).Port, randomString())
	verifier := randomString()
	log.Info("sign-in started", "port", ln.Addr().(*net.TCPAddr).Port)

	type result struct {
		code string
		err  error
	}
	done := make(chan result, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /oauth/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		// Anything on this machine can reach the port. Ignore a wrong state
		// and keep waiting for the real redirect.
		if subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(state)) != 1 {
			log.Warn("ignored a redirect with the wrong state")
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, callbackPage("Relay couldn't connect to Buffer", "This sign-in link has expired. Start again from Relay."))
			return
		}
		res := result{code: q.Get("code")}
		switch {
		case q.Get("error") != "":
			res.err = &oauthError{q.Get("error"), q.Get("error_description")}
		case res.code == "":
			res.err = errors.New("Buffer sent no authorization code")
		}
		if res.err != nil {
			fmt.Fprint(w, callbackPage("Relay couldn't connect to Buffer", html.EscapeString(res.err.Error())+"<br>You can close this tab and try again from Relay."))
		} else {
			fmt.Fprint(w, callbackPage("Relay is connected to Buffer", "You can close this tab and return to Relay."))
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
		"client_id":             {clientID},
		"redirect_uri":          {redirectURI},
		"response_type":         {"code"},
		"scope":                 {scope},
		"state":                 {state},
		"code_challenge":        {challengeFor(verifier)},
		"code_challenge_method": {"S256"},
		"prompt":                {"consent"},
	}
	openURL(c.authURL + "?" + q.Encode())

	ctx, cancel := context.WithTimeout(ctx, signInTimeout)
	defer cancel()
	var res result
	select {
	case res = <-done:
	case <-ctx.Done():
		log.Notice("sign-in cancelled or timed out")
		return errors.New("timed out waiting for Buffer sign-in")
	}
	if res.err != nil {
		log.Warn("sign-in refused", "error", res.err)
		return res.err
	}

	tok, err := c.redeem(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {res.code},
		"redirect_uri":  {redirectURI},
		"code_verifier": {verifier},
	})
	if err != nil {
		log.Warn("token exchange failed", "error", err)
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.store(tok); err != nil {
		log.Error("could not save the token", "error", err)
		return fmt.Errorf("could not save the Buffer token to the keychain: %w", err)
	}
	log.Notice("signed in")
	return nil
}

func callbackPage(title, body string) string {
	return `<!doctype html><meta charset="utf-8"><title>Relay</title>` +
		`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#09090b;color:#e4e4e7;font-family:system-ui,sans-serif">` +
		`<div style="text-align:center"><h1 style="font-size:18px;font-weight:600;color:#fafafa">` + title + `</h1>` +
		`<p style="color:#a1a1aa;font-size:14px">` + body + `</p></div></body>`
}
