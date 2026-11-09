package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAppVersion(t *testing.T) {
	v := appVersion()
	if _, _, ok := parseVersion(v); !ok {
		t.Fatalf("appVersion() = %q, not read from build/config.yml", v)
	}
}

func TestNewer(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"0.0.4", "0.0.3", true},
		{"0.1.0", "0.0.9", true},
		{"1.0.0", "0.9.9", true},
		{"0.0.3", "0.0.3", false},
		{"0.0.2", "0.0.3", false},
		{"0.0.10", "0.0.9", true},
		{"0.0.4", "0.0.4-beta", true},
		{"0.0.4-beta", "0.0.4", false},
		{"0.0.4-beta", "0.0.3", true},
		{"nightly", "0.0.3", false},
		{"0.0.4", "garbage", true},
	}
	for _, c := range cases {
		if got := newer(c.a, c.b); got != c.want {
			t.Errorf("newer(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

func TestCheck(t *testing.T) {
	cur := appVersion()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[
			{"tag_name": "v99.0.0", "html_url": "https://example.test/draft", "draft": true},
			{"tag_name": "v98.0.0", "html_url": "https://example.test/98"},
			{"tag_name": "v` + cur + `", "html_url": "https://example.test/cur"},
			{"tag_name": "not-a-version", "html_url": "https://example.test/x"}
		]`))
	}))
	defer srv.Close()
	s := NewUpdateService()
	s.api = srv.URL

	info, err := s.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !info.Available || info.Latest != "98.0.0" || info.URL != "https://example.test/98" {
		t.Fatalf("got %+v, want 98.0.0 (drafts skipped)", info)
	}
	if s.Status().Last == nil {
		t.Fatal("Status doesn't report the last check")
	}
}

func TestCheckUpToDate(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"tag_name": "v0.0.1", "html_url": "https://example.test/old"}]`))
	}))
	defer srv.Close()
	s := NewUpdateService()
	s.api = srv.URL
	info, err := s.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info.Available || info.URL != "" {
		t.Fatalf("got %+v, want no update", info)
	}
}

func TestCheckRateLimited(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	s := NewUpdateService()
	s.api = srv.URL
	if _, err := s.Check(context.Background()); err == nil {
		t.Fatal("expected an error for 403")
	}
}
