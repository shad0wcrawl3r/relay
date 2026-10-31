package logs

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func reset(t *testing.T, on bool, levels map[string]string) {
	t.Helper()
	Configure(on, levels)
	Clear()
	t.Cleanup(func() {
		Configure(false, nil)
		Clear()
	})
}

func messages(entries []Entry) string {
	var out []string
	for _, e := range entries {
		out = append(out, e.Subsystem+":"+e.Message)
	}
	return strings.Join(out, ",")
}

func TestLevelsArePerSubsystem(t *testing.T) {
	reset(t, true, map[string]string{"ai": "debug", "buffer": "notice", "plane": "off"})
	For("ai").Debug("a1")
	For("buffer").Info("b1")
	For("buffer").Notice("b2")
	For("plane").Error("p1")
	For("terminal").Info("t1")
	For("terminal").Notice("t2")
	if got := messages(Entries(0)); got != "ai:a1,buffer:b2,terminal:t2" {
		t.Errorf("got %s", got)
	}
}

func TestDisabledRecordsNothing(t *testing.T) {
	reset(t, false, map[string]string{"ai": "debug"})
	For("ai").Error("x")
	if got := Entries(0); len(got) != 0 {
		t.Errorf("got %v", got)
	}
}

func TestUnknownLevelFallsBack(t *testing.T) {
	reset(t, true, map[string]string{"ai": "loud"})
	if got := Levels()["ai"]; got != defaultLevel.String() {
		t.Errorf("got %s", got)
	}
}

func TestEntriesAfterSeq(t *testing.T) {
	reset(t, true, nil)
	For("app").Notice("one")
	first := Entries(0)[0].Seq
	For("app").Notice("two")
	if got := messages(Entries(first)); got != "app:two" {
		t.Errorf("got %s", got)
	}
	if got := Entries(first + 1); len(got) != 0 {
		t.Errorf("got %v", got)
	}
}

func TestRingDropsOldest(t *testing.T) {
	reset(t, true, map[string]string{"app": "debug"})
	for range capacity + 10 {
		For("app").Debug("x")
	}
	got := Entries(0)
	if len(got) != capacity || got[len(got)-1].Seq-got[0].Seq != capacity-1 {
		t.Errorf("len %d, span %d", len(got), got[len(got)-1].Seq-got[0].Seq)
	}
}

func TestSecretsAreRedacted(t *testing.T) {
	reset(t, true, map[string]string{"ai": "debug"})
	For("ai").Error("failed with Bearer abc123 and sk-or-v1-abcdefghijkl",
		"access_token", "leaked-value", "client_secret", "s3cret-value", "prompt", "hello article", "body", "b", "text", "t",
		"error", errors.New(`POST https://x/y?code=abc&state=1: bad key=zzz`),
		"model", "ok-model", "status", 200)
	e := Entries(0)[0]
	line := e.Message + " " + e.Fields
	for _, secret := range []string{"abc123", "sk-or", "leaked-value", "s3cret-value", "hello article", "code=abc", "zzz"} {
		if strings.Contains(line, secret) {
			t.Errorf("%q leaked in %s", secret, line)
		}
	}
	for _, kept := range []string{"model=ok-model", "status=200", "state=1"} {
		if !strings.Contains(line, kept) {
			t.Errorf("%q missing from %s", kept, line)
		}
	}
}

func TestTransportLogsCallsWithoutQueriesOrBodies(t *testing.T) {
	reset(t, true, map[string]string{"ai": "debug"})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/limited" {
			w.Header().Set("Retry-After", "30")
			w.WriteHeader(http.StatusTooManyRequests)
		}
	}))
	defer srv.Close()
	client := &http.Client{Transport: Transport("ai", nil)}
	for _, path := range []string{"/ok?secretish=1", "/limited"} {
		resp, err := client.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
	}
	got := Entries(0)
	if len(got) != 2 {
		t.Fatalf("got %v", got)
	}
	if got[0].Level != "debug" || strings.Contains(got[0].Fields, "secretish") || !strings.Contains(got[0].Fields, "status=200") {
		t.Errorf("entry = %+v", got[0])
	}
	if got[1].Level != "warn" || !strings.Contains(got[1].Fields, "retry-after=30") {
		t.Errorf("entry = %+v", got[1])
	}
}

func TestTransportLogsNetworkFailures(t *testing.T) {
	reset(t, true, nil)
	client := &http.Client{Transport: Transport("ai", nil)}
	if _, err := client.Get("http://127.0.0.1:1/x"); err == nil {
		t.Fatal("expected an error")
	}
	if got := Entries(0); len(got) != 1 || got[0].Level != "warn" {
		t.Errorf("got %+v", got)
	}
}
