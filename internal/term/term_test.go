package term

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if cond() {
			return
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestSnapshotReattach(t *testing.T) {
	m := NewManager(1000)
	defer m.Close()
	info, err := m.Create(Options{Shell: "/bin/sh", Cwd: t.TempDir(), Cols: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	s, _ := m.Get(info.ID)
	if _, err := s.Write([]byte("printf 'hello-%s\\n' relay\n")); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "output in emulator", func() bool {
		snap, _, detach := s.Attach()
		detach()
		return strings.Contains(string(snap), "hello-relay")
	})

	// Output after attaching arrives on the channel, not in the snapshot.
	snap, out, detach := s.Attach()
	defer detach()
	if strings.Contains(string(snap), "second") {
		t.Fatal("snapshot has output that hasn't happened yet")
	}
	s.Write([]byte("echo second\n"))
	var got strings.Builder
	waitFor(t, "live output", func() bool {
		select {
		case c := <-out:
			got.Write(c)
		default:
		}
		return strings.Contains(got.String(), "second")
	})
}

func TestAltScreenSnapshot(t *testing.T) {
	m := NewManager(100)
	defer m.Close()
	info, _ := m.Create(Options{Shell: "/bin/sh", Cols: 40, Rows: 10})
	s, _ := m.Get(info.ID)
	s.Write([]byte("printf '\\033[?1049h\\033[?2004hTUI'; sleep 5\n"))
	waitFor(t, "alt screen", func() bool { return s.Info().AltScreen })
	snap, _, detach := s.Attach()
	detach()
	if !strings.Contains(string(snap), "\x1b[?1049h") || !strings.Contains(string(snap), "\x1b[?2004h") {
		t.Errorf("snapshot lacks alt screen / bracketed paste: %q", snap)
	}
}

func TestExitAndKill(t *testing.T) {
	m := NewManager(100)
	defer m.Close()
	info, _ := m.Create(Options{Shell: "/bin/sh"})
	s, _ := m.Get(info.ID)
	s.Write([]byte("exit 3\n"))
	waitFor(t, "exit", func() bool { return s.Info().Status == StatusExited })
	if c := s.Info().ExitCode; c != 3 {
		t.Errorf("exit code = %d", c)
	}
	if err := m.Kill(info.ID); err != nil || len(m.List()) != 0 {
		t.Errorf("kill: %v, list=%v", err, m.List())
	}
}

func TestServerRequiresToken(t *testing.T) {
	m := NewManager(100)
	defer m.Close()
	srv, err := NewServer(m)
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	if !strings.HasPrefix(srv.URL(), "ws://127.0.0.1:") {
		t.Errorf("bound to %s", srv.URL())
	}
	info, _ := m.Create(Options{Shell: "/bin/sh"})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, resp, err := websocket.Dial(ctx, srv.URL()+"/term/"+info.ID+"?token=wrong", nil)
	if err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("wrong token: err=%v resp=%v", err, resp)
	}

	c, _, err := websocket.Dial(ctx, srv.URL()+"/term/"+info.ID+"?token="+srv.Token(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	if _, _, err := c.Read(ctx); err != nil { // snapshot
		t.Fatal(err)
	}
	c.Write(ctx, websocket.MessageBinary, []byte("echo via-ws\n"))
	var got strings.Builder
	for !strings.Contains(got.String(), "via-ws\r\n") {
		_, data, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("read: %v (got %q)", err, got.String())
		}
		got.Write(data)
	}
}
