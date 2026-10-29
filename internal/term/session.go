// Package term owns Relay's terminal sessions: a PTY, the process attached to
// it and a headless VT emulator per session. Sessions outlive the React panes
// that show them; a pane only attaches and detaches.
package term

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	pty "github.com/aymanbagabas/go-pty"
	"github.com/charmbracelet/x/ansi"
	"github.com/charmbracelet/x/vt"
)

// Status is what the sessions sidebar shows for a session.
type Status string

const (
	StatusIdle    Status = "idle"    // the shell is in the foreground
	StatusRunning Status = "running" // another process is in the foreground
	StatusExited  Status = "exited"  // the shell itself has exited
)

// Info describes a session to the frontend.
type Info struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Shell   string `json:"shell"`
	Cwd     string `json:"cwd"`
	Title   string `json:"title"`
	Process string `json:"process"` // foreground process name; empty when unknown
	Status  Status `json:"status"`
	// Since is when the foreground process started (running) or the shell
	// exited (exited).
	Since     time.Time `json:"since"`
	ExitCode  int       `json:"exitCode"`
	AltScreen bool      `json:"altScreen"`
	Cols      int       `json:"cols"`
	Rows      int       `json:"rows"`
	Created   time.Time `json:"created"`
}

// Options for a new session. Zero values pick defaults.
type Options struct {
	Name  string `json:"name"`
	Shell string `json:"shell"`
	Cwd   string `json:"cwd"`
	Cols  int    `json:"cols"`
	Rows  int    `json:"rows"`
}

// Session is one shell on one PTY.
type Session struct {
	id      string
	shell   string
	created time.Time
	pty     pty.Pty
	cmd     *pty.Cmd
	onEvent func()

	mu        sync.Mutex
	name      string
	cwd       string
	title     string
	process   string
	since     time.Time
	exited    bool
	exitCode  int
	altScreen bool
	modes     map[ansi.Mode]bool
	emu       *vt.Emulator
	subs      map[chan []byte]struct{}
}

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func defaultShell() string {
	if s := os.Getenv("SHELL"); s != "" {
		return s
	}
	return "/bin/zsh"
}

func start(o Options, scrollback int, onEvent func()) (*Session, error) {
	if o.Shell == "" {
		o.Shell = defaultShell()
	}
	if o.Cwd == "" {
		o.Cwd, _ = os.UserHomeDir()
	}
	if o.Cols <= 0 || o.Rows <= 0 {
		o.Cols, o.Rows = 100, 30
	}
	if o.Name = sanitizeName(o.Name); o.Name == "" {
		o.Name = filepath.Base(o.Shell)
	}
	p, err := pty.New()
	if err != nil {
		return nil, err
	}
	if err := p.Resize(o.Cols, o.Rows); err != nil {
		p.Close()
		return nil, err
	}
	cmd := p.Command(o.Shell, "-l")
	cmd.Dir = o.Cwd
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor", "TERM_PROGRAM=Relay")
	if err := cmd.Start(); err != nil {
		p.Close()
		return nil, err
	}

	s := &Session{
		id: newID(), shell: o.Shell, created: time.Now(), pty: p, cmd: cmd, onEvent: onEvent,
		name: o.Name, cwd: o.Cwd, since: time.Now(),
		modes: map[ansi.Mode]bool{}, subs: map[chan []byte]struct{}{},
	}
	s.emu = vt.NewEmulator(o.Cols, o.Rows)
	s.emu.SetScrollbackSize(scrollback)
	// Callbacks run inside emu.Write, which pump calls with s.mu held.
	s.emu.SetCallbacks(vt.Callbacks{
		Title:            func(t string) { s.title = t; s.changed() },
		WorkingDirectory: func(d string) { s.cwd = cwdFromOSC7(d); s.changed() },
		AltScreen:        func(on bool) { s.altScreen = on; s.changed() },
		EnableMode:       func(m ansi.Mode) { s.modes[m] = true },
		DisableMode:      func(m ansi.Mode) { delete(s.modes, m) },
	})
	// The emulator answers terminal queries (DA, DSR) into a synchronous
	// pipe. xterm.js answers them for real, so drain and drop these.
	go io.Copy(io.Discard, s.emu)
	go s.pump()
	go s.wait()
	return s, nil
}

// changed notifies the manager asynchronously; callers may hold s.mu.
func (s *Session) changed() {
	if s.onEvent != nil {
		go s.onEvent()
	}
}

func (s *Session) pump() {
	buf := make([]byte, 32*1024)
	for {
		n, err := s.pty.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			s.mu.Lock()
			_, _ = s.emu.Write(chunk)
			for ch := range s.subs {
				select {
				case ch <- chunk:
				default:
					// Too slow to keep up: drop it. The pane reattaches and
					// gets a fresh snapshot.
					close(ch)
					delete(s.subs, ch)
				}
			}
			s.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

func (s *Session) wait() {
	err := s.cmd.Wait()
	code := 0
	if s.cmd.ProcessState != nil {
		code = s.cmd.ProcessState.ExitCode()
	} else if err != nil {
		code = -1
	}
	s.mu.Lock()
	s.exited, s.exitCode, s.since, s.process = true, code, time.Now(), ""
	for ch := range s.subs {
		close(ch)
	}
	s.subs = map[chan []byte]struct{}{}
	s.mu.Unlock()
	s.pty.Close()
	s.changed()
}

// Attach returns a snapshot of the screen and a channel of output that
// follows it with nothing lost or repeated. Call detach when done.
func (s *Session) Attach() (snapshot []byte, out <-chan []byte, detach func()) {
	ch := make(chan []byte, 256)
	s.mu.Lock()
	snapshot = s.snapshot()
	if s.exited {
		close(ch)
	} else {
		s.subs[ch] = struct{}{}
	}
	s.mu.Unlock()
	return snapshot, ch, func() {
		s.mu.Lock()
		if _, ok := s.subs[ch]; ok {
			delete(s.subs, ch)
			close(ch)
		}
		s.mu.Unlock()
	}
}

func (s *Session) Write(p []byte) (int, error) {
	s.mu.Lock()
	exited := s.exited
	s.mu.Unlock()
	if exited {
		return 0, errors.New("session has exited")
	}
	return s.pty.Write(p)
}

func (s *Session) Resize(cols, rows int) error {
	if cols <= 0 || rows <= 0 {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.exited || (cols == s.emu.Width() && rows == s.emu.Height()) {
		return nil
	}
	s.emu.Resize(cols, rows)
	return s.pty.Resize(cols, rows)
}

func (s *Session) Rename(name string) {
	s.mu.Lock()
	s.name = sanitizeName(name)
	s.mu.Unlock()
	s.changed()
}

// Kill hangs up the shell. wait() records the exit.
func (s *Session) Kill() {
	if s.cmd.Process != nil {
		_ = hangup(s.cmd.Process)
	}
	go func() {
		time.Sleep(2 * time.Second)
		s.mu.Lock()
		exited := s.exited
		s.mu.Unlock()
		if !exited && s.cmd.Process != nil {
			_ = s.cmd.Process.Kill()
		}
	}()
}

// refresh updates the foreground process; it reports whether anything changed.
func (s *Session) refresh() bool {
	s.mu.Lock()
	if s.exited {
		s.mu.Unlock()
		return false
	}
	s.mu.Unlock()
	proc := foreground(s.pty, s.cmd)
	s.mu.Lock()
	defer s.mu.Unlock()
	if proc == s.process {
		return false
	}
	s.process, s.since = proc, time.Now()
	return true
}

func (s *Session) Info() Info {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := StatusIdle
	switch {
	case s.exited:
		st = StatusExited
	case s.process != "" && s.process != filepath.Base(s.shell) && "-"+s.process != filepath.Base(s.shell):
		st = StatusRunning
	}
	return Info{
		ID: s.id, Name: s.name, Shell: filepath.Base(s.shell), Cwd: s.cwd, Title: s.title,
		Process: s.process, Status: st, Since: s.since, ExitCode: s.exitCode,
		AltScreen: s.altScreen, Cols: s.emu.Width(), Rows: s.emu.Height(), Created: s.created,
	}
}
