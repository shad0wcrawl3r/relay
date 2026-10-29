package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/term"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// TerminalService exposes Go-owned terminal sessions. Control goes through
// these bindings; PTY bytes go over the token-guarded WebSocket in Endpoint.
// Session changes are pushed as "term:sessions" events.
type TerminalService struct {
	m   *term.Manager
	srv *term.Server
}

// Endpoint is where panes attach: <URL>/term/<id>?token=<Token>.
type Endpoint struct {
	URL   string `json:"url"`
	Token string `json:"token"`
	// Home lets the UI shorten folders to ~.
	Home string `json:"home"`
}

func NewTerminalService() *TerminalService {
	return &TerminalService{}
}

func (s *TerminalService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	scrollback := config.GetConfig().Terminal.Scrollback
	if scrollback <= 0 {
		scrollback = 10000
	}
	s.m = term.NewManager(scrollback)
	srv, err := term.NewServer(s.m)
	if err != nil {
		return err
	}
	s.srv = srv
	s.m.OnChange = func() {
		if app := application.Get(); app != nil {
			app.Event.Emit("term:sessions", s.m.List())
		}
	}
	go s.m.Run(ctx)
	return nil
}

// ServiceShutdown ends every session: surviving a quit is v2.
func (s *TerminalService) ServiceShutdown() error {
	if s.m != nil {
		s.m.Close()
	}
	if s.srv != nil {
		return s.srv.Close()
	}
	return nil
}

func (s *TerminalService) Endpoint() Endpoint {
	home, _ := os.UserHomeDir()
	return Endpoint{URL: s.srv.URL(), Token: s.srv.Token(), Home: home}
}

func (s *TerminalService) Create(o term.Options) (term.Info, error) {
	if o.Shell == "" {
		o.Shell = config.GetConfig().Terminal.Shell
	}
	if o.Cwd != "" {
		if st, err := os.Stat(o.Cwd); err != nil || !st.IsDir() {
			o.Cwd = ""
		}
	}
	return s.m.Create(o)
}

func (s *TerminalService) List() []term.Info { return s.m.List() }

func (s *TerminalService) Kill(id string) error { return s.m.Kill(id) }

func (s *TerminalService) Resize(id string, cols, rows int) error {
	sess, err := s.m.Get(id)
	if err != nil {
		return err
	}
	return sess.Resize(cols, rows)
}

func (s *TerminalService) Rename(id, name string) error {
	sess, err := s.m.Get(id)
	if err != nil {
		return err
	}
	sess.Rename(name)
	return nil
}

func layoutPath() string { return filepath.Join(config.AppDir(), "terminal-layout.json") }

// LoadLayout returns the saved tabs and split trees as JSON ("" if none).
// The layout holds session names and folders only, no output.
func (s *TerminalService) LoadLayout() (string, error) {
	b, err := os.ReadFile(layoutPath())
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	return string(b), err
}

func (s *TerminalService) SaveLayout(layout string) error {
	if err := os.MkdirAll(config.AppDir(), 0o700); err != nil {
		return err
	}
	tmp := layoutPath() + ".tmp"
	if err := os.WriteFile(tmp, []byte(layout), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, layoutPath())
}

// Keymap is the terminal view's prefix and bindings: tmux's defaults, with
// the user's tmux config applied on top when that setting is on.
func (s *TerminalService) Keymap() term.Keymap {
	if !config.GetConfig().Terminal.TmuxKeys {
		return term.DefaultKeymap()
	}
	home, _ := os.UserHomeDir()
	return term.LoadTmuxKeymap(home)
}

// TmuxConfig names the tmux config Relay would read, or "" if none exists.
func (s *TerminalService) TmuxConfig() string {
	home, _ := os.UserHomeDir()
	for _, p := range term.TmuxConfPaths(home) {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}
