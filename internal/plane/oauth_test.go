package plane

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

func tokenServer(t *testing.T, acceptBasic, acceptBody bool, calls *int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*calls++
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.PostForm.Get("code") != "the-code" || r.PostForm.Get("code_verifier") != "v" {
			t.Errorf("grant params lost: %v", r.PostForm)
		}
		user, pass, basic := r.BasicAuth()
		basicOK := basic && user == "id%2B1" && pass == "s%2Fcret"
		bodyOK := r.PostForm.Get("client_id") == "id+1" && r.PostForm.Get("client_secret") == "s/cret"
		if (acceptBasic && basicOK) || (acceptBody && bodyOK) {
			fmt.Fprint(w, `{"access_token":"at","refresh_token":"rt","expires_in":3600}`)
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"error":"invalid_client"}`)
	}))
}

func TestExchangeClientAuth(t *testing.T) {
	grant := url.Values{"grant_type": {"authorization_code"}, "code": {"the-code"}, "code_verifier": {"v"}}
	for _, tc := range []struct {
		name        string
		basic, body bool
		wantCalls   int
		wantErr     bool
	}{
		{"basic accepted", true, false, 1, false},
		{"body only falls back", false, true, 2, false},
		{"both rejected", false, false, 2, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			srv := tokenServer(t, tc.basic, tc.body, &calls)
			defer srv.Close()
			config.Override(func(c *config.Config) {
				c.Plane.BaseURL = srv.URL
				c.Plane.ClientID = " id+1 "
				c.Plane.ClientSecret = "s/cret"
			})
			tok, err := exchange(context.Background(), config.GetConfig(), grant)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v", err)
			}
			if !tc.wantErr && tok.AccessToken != "at" {
				t.Errorf("token = %+v", tok)
			}
			if calls != tc.wantCalls {
				t.Errorf("calls = %d, want %d", calls, tc.wantCalls)
			}
		})
	}
}
