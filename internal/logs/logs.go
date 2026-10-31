// Package logs is Relay's per-subsystem logger. Entries stay in memory, in a
// ring buffer, and go to stderr: nothing reaches disk, so logs need no vault.
//
// Callers still must not log locked project data, prompts or article text.
// Sensitive field names and token-shaped values are redacted as a backstop.
package logs

import (
	"fmt"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

type Level int

const (
	Debug Level = iota
	Info
	Notice
	Warn
	Error
	Off
)

var levelNames = []string{"debug", "info", "notice", "warn", "error", "off"}

func (l Level) String() string { return levelNames[l] }

// ParseLevel reads a level name.
func ParseLevel(s string) (Level, bool) {
	i := slices.Index(levelNames, s)
	return Level(max(i, 0)), i >= 0
}

const defaultLevel = Notice

// capacity bounds memory; the oldest entries drop first.
const capacity = 5000

// Subsystem is a part of Relay with its own log level.
type Subsystem struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Subsystems lists every logger, in display order.
var Subsystems = []Subsystem{
	{"app", "App"},
	{"ai", "Model providers"},
	{"buffer", "Buffer"},
	{"devto", "Dev.to"},
	{"plane", "Plane"},
	{"posts", "Posts"},
	{"privacy", "Privacy"},
	{"terminal", "Terminal"},
}

// Entry is one log line.
type Entry struct {
	Seq       uint64    `json:"seq"`
	Time      time.Time `json:"time"`
	Subsystem string    `json:"subsystem"`
	Level     string    `json:"level"`
	Message   string    `json:"message"`
	Fields    string    `json:"fields"`
}

var (
	mu      sync.Mutex
	enabled bool
	levels  = map[string]Level{}
	ring    []Entry
	seq     uint64
)

// Configure sets whether logging is on and each subsystem's level. A subsystem
// left out, or with an unknown level, uses the default.
func Configure(on bool, subsystemLevels map[string]string) {
	next := map[string]Level{}
	for id, name := range subsystemLevels {
		if l, ok := ParseLevel(name); ok {
			next[id] = l
		}
	}
	mu.Lock()
	defer mu.Unlock()
	enabled, levels = on, next
}

// Enabled reports whether logging is on.
func Enabled() bool {
	mu.Lock()
	defer mu.Unlock()
	return enabled
}

// Levels returns the effective level of every subsystem.
func Levels() map[string]string {
	mu.Lock()
	defer mu.Unlock()
	out := make(map[string]string, len(Subsystems))
	for _, s := range Subsystems {
		out[s.ID] = levelFor(s.ID).String()
	}
	return out
}

func levelFor(id string) Level {
	if l, ok := levels[id]; ok {
		return l
	}
	return defaultLevel
}

// Entries returns those after seq, oldest first.
func Entries(after uint64) []Entry {
	mu.Lock()
	defer mu.Unlock()
	i, _ := slices.BinarySearchFunc(ring, after+1, func(e Entry, s uint64) int {
		if e.Seq < s {
			return -1
		}
		if e.Seq > s {
			return 1
		}
		return 0
	})
	return slices.Clone(ring[i:])
}

// Clear drops every stored entry.
func Clear() {
	mu.Lock()
	defer mu.Unlock()
	ring = nil
}

// Logger writes entries for one subsystem.
type Logger struct{ subsystem string }

// For returns the logger for a subsystem.
func For(subsystem string) Logger { return Logger{subsystem} }

func (l Logger) Debug(msg string, kv ...any)  { l.log(Debug, msg, kv) }
func (l Logger) Info(msg string, kv ...any)   { l.log(Info, msg, kv) }
func (l Logger) Notice(msg string, kv ...any) { l.log(Notice, msg, kv) }
func (l Logger) Warn(msg string, kv ...any)   { l.log(Warn, msg, kv) }
func (l Logger) Error(msg string, kv ...any)  { l.log(Error, msg, kv) }

func (l Logger) log(level Level, msg string, kv []any) {
	mu.Lock()
	defer mu.Unlock()
	if !enabled || level < levelFor(l.subsystem) {
		return
	}
	seq++
	e := Entry{
		Seq: seq, Time: time.Now(), Subsystem: l.subsystem, Level: level.String(),
		Message: scrub(msg), Fields: format(kv),
	}
	ring = append(ring, e)
	if len(ring) > capacity {
		ring = slices.Clone(ring[len(ring)-capacity:])
	}
	fmt.Fprintf(os.Stderr, "%s %-6s %-8s %s %s\n", e.Time.Format("15:04:05.000"), e.Level, e.Subsystem, e.Message, e.Fields)
}

var sensitiveKeys = []string{"token", "secret", "password", "authorization", "cookie", "api_key", "apikey", "body", "prompt", "content", "text", "verifier"}

// Matches bearer tokens, common API key prefixes and credentials in URLs.
var sensitiveValues = regexp.MustCompile(`(?i)bearer\s+\S+|\b(sk|pk|rk)-[a-z0-9_-]{8,}|\b(code|token|access_token|refresh_token|code_verifier|client_secret|api_key|key)=[^&\s"]+`)

func scrub(s string) string {
	return sensitiveValues.ReplaceAllStringFunc(s, func(m string) string {
		if k, _, ok := strings.Cut(m, "="); ok {
			return k + "=[redacted]"
		}
		return "[redacted]"
	})
}

func format(kv []any) string {
	var b strings.Builder
	for i := 0; i+1 < len(kv); i += 2 {
		key := fmt.Sprint(kv[i])
		value := "[redacted]"
		lower := strings.ToLower(key)
		if !slices.ContainsFunc(sensitiveKeys, func(s string) bool { return strings.Contains(lower, s) }) {
			value = scrub(fmt.Sprint(kv[i+1]))
		}
		if strings.ContainsAny(value, " \t\n\"") {
			value = fmt.Sprintf("%q", value)
		}
		if b.Len() > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(key + "=" + value)
	}
	return b.String()
}

type transport struct {
	log  Logger
	next http.RoundTripper
}

// Transport logs every HTTP call for a subsystem: method, host, path, status,
// duration and rate-limit headers. It never logs bodies, headers with
// credentials, or query strings.
func Transport(subsystem string, next http.RoundTripper) http.RoundTripper {
	if next == nil {
		next = http.DefaultTransport
	}
	return transport{For(subsystem), next}
}

// logged are safe, useful response headers for diagnosing limits.
var logged = []string{"Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "RateLimit", "RateLimit-Policy"}

func (t transport) RoundTrip(req *http.Request) (*http.Response, error) {
	start := time.Now()
	resp, err := t.next.RoundTrip(req)
	kv := []any{"method", req.Method, "url", req.URL.Host + req.URL.Path, "ms", time.Since(start).Milliseconds()}
	if err != nil {
		t.log.Warn("request failed", append(kv, "error", err)...)
		return nil, err
	}
	kv = append(kv, "status", resp.StatusCode)
	for _, h := range logged {
		if v := resp.Header.Get(h); v != "" {
			kv = append(kv, strings.ToLower(h), v)
		}
	}
	switch {
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		t.log.Warn("request failed", kv...)
	case resp.StatusCode >= 400:
		t.log.Notice("request refused", kv...)
	default:
		t.log.Debug("request", kv...)
	}
	return resp, nil
}
