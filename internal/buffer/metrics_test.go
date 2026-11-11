package buffer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"
)

func TestPostMetricsBatchesAndParses(t *testing.T) {
	c, got := captureVars(t, `{"data":{"p0":{"id":"a","metrics":[{"type":"reactions","name":"Reactions","value":12,"unit":"count"}],"metricsUpdatedAt":"2026-11-10T00:00:00Z"},"p1":null}}`)
	m, err := c.PostMetrics(context.Background(), "", []string{"a", "gone"})
	if err != nil {
		t.Fatal(err)
	}
	if a := m["a"]; !a.Found || len(a.Metrics) != 1 || a.Metrics[0].Value != 12 || a.UpdatedAt == nil {
		t.Fatalf("a = %+v", a)
	}
	if g := m["gone"]; g.Found {
		t.Fatalf("missing post reported as found: %+v", g)
	}
	// IDs travel as variables, never spliced into the query.
	if jsonOf(got.Variables["in1"]) != `{"id":"gone"}` {
		t.Fatalf("variables = %v", got.Variables)
	}
}

func TestPostMetricsWithoutScopeNeedsKey(t *testing.T) {
	c, _ := captureVars(t, `{"errors":[{"message":"Missing required scope: insightsRead"}]}`)
	if _, err := c.PostMetrics(context.Background(), "", []string{"a"}); !errors.Is(err, ErrNoInsights) {
		t.Fatalf("err = %v, want ErrNoInsights", err)
	}
}

// A wrong personal key must not sign the OAuth session out.
func TestBadInsightsKeyKeepsSignIn(t *testing.T) {
	var auth string
	c := newClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		if auth == "Bearer personal" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&struct{}{})
		fmt.Fprint(w, `{"data":{"account":{"name":"x"}}}`)
	})
	seed(t, c, Token{AccessToken: "ok", Expiry: time.Now().Add(time.Hour)})
	signedOut := false
	c.OnSignOut = func() { signedOut = true }

	if err := c.CheckKey(context.Background(), "personal"); !errors.Is(err, ErrBadKey) {
		t.Fatalf("err = %v, want ErrBadKey", err)
	}
	if _, err := c.PostMetrics(context.Background(), "personal", []string{"a"}); !errors.Is(err, ErrBadKey) {
		t.Fatalf("metrics err = %v", err)
	}
	if signedOut || !c.Connected() {
		t.Fatal("a refused personal key signed Buffer out")
	}
}
