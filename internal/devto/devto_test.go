package devto

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestFlexTags(t *testing.T) {
	for _, in := range []string{`["go","wails"]`, `"go, wails"`} {
		var f flexTags
		if err := json.Unmarshal([]byte(in), &f); err != nil {
			t.Fatal(err)
		}
		if strings.Join(f, ",") != "go,wails" {
			t.Errorf("%s -> %v", in, f)
		}
	}
}

func TestUpdateNeverSendsPublished(t *testing.T) {
	// Re-sending must not unpublish an article that went live on Dev.to.
	p := Payload{Title: "t"}
	p.Published = nil
	b, _ := json.Marshal(p)
	if strings.Contains(string(b), "published") {
		t.Errorf("update payload contains published: %s", b)
	}
	f := false
	p.Published = &f
	b, _ = json.Marshal(p)
	if !strings.Contains(string(b), `"published":false`) {
		t.Errorf("create payload missing published:false: %s", b)
	}
}

type fakeDevto func(*http.Request) (*http.Response, error)

func (f fakeDevto) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestCheckRefusesABadKey(t *testing.T) {
	old := httpClient.Transport
	t.Cleanup(func() { httpClient.Transport = old })
	httpClient.Transport = fakeDevto(func(r *http.Request) (*http.Response, error) {
		status, body := http.StatusUnauthorized, `{"error":"unauthorized","status":401}`
		if r.Header.Get("api-key") == "good" && r.URL.Path == "/api/users/me" {
			status, body = http.StatusOK, `{"username":"ash","name":"Ash"}`
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
	})
	if _, err := Check(context.Background(), "not-a-real-devto-key-0000"); !errors.Is(err, ErrBadKey) {
		t.Errorf("bad key: err = %v", err)
	}
	if u, err := Check(context.Background(), " good "); err != nil || u.Username != "ash" {
		t.Errorf("good key: %+v, %v", u, err)
	}
}
