package term

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"
)

var ErrNoSession = errors.New("term: no such session")

// Manager maps session IDs to live sessions.
type Manager struct {
	Scrollback int
	// OnChange is called (from any goroutine) when a session is added,
	// removed or changes state. Calls may be coalesced.
	OnChange func()

	mu       sync.Mutex
	sessions map[string]*Session
	pending  chan struct{}
}

func NewManager(scrollback int) *Manager {
	m := &Manager{Scrollback: scrollback, sessions: map[string]*Session{}, pending: make(chan struct{}, 1)}
	return m
}

// Run notifies OnChange of state changes and polls foreground processes,
// until ctx is done.
func (m *Manager) Run(ctx context.Context) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			changed := false
			for _, s := range m.all() {
				changed = s.refresh() || changed
			}
			if changed {
				m.notify()
			}
		case <-m.pending:
			if m.OnChange != nil {
				m.OnChange()
			}
		}
	}
}

func (m *Manager) notify() {
	select {
	case m.pending <- struct{}{}:
	default:
	}
}

func (m *Manager) Create(o Options) (Info, error) {
	s, err := start(o, m.Scrollback, m.notify)
	if err != nil {
		return Info{}, err
	}
	m.mu.Lock()
	m.sessions[s.id] = s
	m.mu.Unlock()
	m.notify()
	return s.Info(), nil
}

func (m *Manager) Get(id string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, ErrNoSession
	}
	return s, nil
}

func (m *Manager) all() []*Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s)
	}
	return out
}

// List returns every session, oldest first.
func (m *Manager) List() []Info {
	out := []Info{}
	for _, s := range m.all() {
		out = append(out, s.Info())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created.Before(out[j].Created) })
	return out
}

// Kill ends a session's shell and forgets it.
func (m *Manager) Kill(id string) error {
	m.mu.Lock()
	s, ok := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if !ok {
		return ErrNoSession
	}
	s.Kill()
	m.notify()
	return nil
}

// Running reports how many sessions have a non-shell foreground process.
func (m *Manager) Running() int {
	n := 0
	for _, s := range m.all() {
		if s.Info().Status == StatusRunning {
			n++
		}
	}
	return n
}

// Close ends every session.
func (m *Manager) Close() {
	for _, s := range m.all() {
		s.Kill()
	}
}
