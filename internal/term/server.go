package term

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
)

// flushEvery batches PTY output into fewer WebSocket frames.
const flushEvery = 10 * time.Millisecond

// Server carries PTY output and input over a WebSocket on 127.0.0.1, guarded
// by a token minted per launch. Control (create, resize, kill) goes through
// Wails bindings instead.
type Server struct {
	m     *Manager
	token string
	ln    net.Listener
	srv   *http.Server
}

func NewServer(m *Manager) (*Server, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	s := &Server{m: m, token: hex.EncodeToString(b), ln: ln}
	mux := http.NewServeMux()
	mux.HandleFunc("/term/{id}", s.handle)
	s.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go s.srv.Serve(ln)
	return s, nil
}

// URL is the WebSocket base, e.g. ws://127.0.0.1:53121.
func (s *Server) URL() string   { return "ws://" + s.ln.Addr().String() }
func (s *Server) Token() string { return s.token }

func (s *Server) Close() error { return s.srv.Close() }

func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
	if subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("token")), []byte(s.token)) != 1 {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	sess, err := s.m.Get(r.PathValue("id"))
	if err != nil {
		http.Error(w, "no such session", http.StatusNotFound)
		return
	}
	// The webview's origin differs between dev (http://localhost) and builds
	// (wails://); the token is what authenticates.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	conn.SetReadLimit(1 << 20)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	snap, out, detach := sess.Attach()
	defer detach()

	go func() {
		defer cancel()
		for {
			typ, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			if typ == websocket.MessageBinary {
				if _, err := sess.Write(data); err != nil {
					return
				}
			}
		}
	}()

	if err := conn.Write(ctx, websocket.MessageBinary, snap); err != nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			conn.Close(websocket.StatusNormalClosure, "")
			return
		case chunk, ok := <-out:
			if !ok {
				info := sess.Info()
				reason := "detached"
				if info.Status == StatusExited {
					reason = fmt.Sprintf("exit %d", info.ExitCode)
				}
				conn.Close(websocket.StatusNormalClosure, reason)
				return
			}
			batch := append([]byte(nil), chunk...)
			timer := time.NewTimer(flushEvery)
		collect:
			for len(batch) < 256*1024 {
				select {
				case more, ok := <-out:
					if !ok {
						break collect
					}
					batch = append(batch, more...)
				case <-timer.C:
					break collect
				}
			}
			timer.Stop()
			if err := conn.Write(ctx, websocket.MessageBinary, batch); err != nil {
				return
			}
		}
	}
}

// sanitizeName keeps session names to one short line.
func sanitizeName(n string) string {
	n = strings.TrimSpace(strings.ReplaceAll(n, "\n", " "))
	if len(n) > 40 {
		n = n[:40]
	}
	return n
}
