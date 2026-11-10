package buffer

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

func TestRateLimitStopsRequestsUntilTheWaitIsOver(t *testing.T) {
	var calls atomic.Int32
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {}, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Retry-After", "441")
		w.WriteHeader(http.StatusTooManyRequests)
	})
	seed(t, c, Token{AccessToken: "ok", Expiry: time.Now().Add(time.Hour)})

	var limited *RateLimited
	if _, err := c.Account(context.Background()); !errors.As(err, &limited) {
		t.Fatalf("got %v, want a RateLimited error", err)
	}
	if d := time.Until(limited.Until); d < 430*time.Second || d > 442*time.Second {
		t.Errorf("waits %v, want about 441s", d)
	}
	// Later requests don't reach Buffer while the wait runs.
	for range 3 {
		if _, err := c.Account(context.Background()); !errors.As(err, &limited) {
			t.Fatalf("got %v", err)
		}
	}
	if n := calls.Load(); n != 1 {
		t.Errorf("Buffer was asked %d times, want 1", n)
	}
	if _, on := c.RateLimit(); !on {
		t.Error("RateLimit should report the wait")
	}
}

func TestRetryAfter(t *testing.T) {
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	if got := retryAfter("30", now); !got.Equal(now.Add(30 * time.Second)) {
		t.Errorf("seconds: %v", got)
	}
	if got := retryAfter("Tue, 10 Nov 2026 12:05:00 GMT", now); !got.Equal(now.Add(5 * time.Minute)) {
		t.Errorf("date: %v", got)
	}
	if got := retryAfter("", now); !got.Equal(now.Add(defaultRetryAfter)) {
		t.Errorf("missing: %v", got)
	}
}
