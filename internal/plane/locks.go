package plane

import (
	"errors"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

// Locked projects and modules stay in memory (and in the encrypted cache)
// but never reach the UI until the device owner unlocks them. Unlocks last
// until the auto-lock timeout, a manual lock, or quit.

var ErrLocked = errors.New("this is locked; unlock it first")

func ProjectKey(identifier string) string { return "project:" + strings.ToUpper(identifier) }
func ModuleKey(id string) string          { return "module:" + id }

// Lockable reports whether key is configured as locked.
func Lockable(key string) bool {
	return slices.Contains(config.GetConfig().Privacy.Locked, key)
}

type Locks struct {
	mu       sync.Mutex
	until    map[string]time.Time
	now      func() time.Time
	reported map[string]bool
}

func NewLocks() *Locks {
	return &Locks{until: map[string]time.Time{}, reported: map[string]bool{}, now: time.Now}
}

func autoLock() time.Duration {
	m := config.GetConfig().Privacy.AutoLockMinutes
	if m <= 0 {
		m = 15
	}
	return time.Duration(m) * time.Minute
}

// Locked reports whether key is lockable and not currently unlocked.
func (l *Locks) Locked(key string) bool {
	if !Lockable(key) {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return !l.now().Before(l.until[key])
}

func (l *Locks) Unlock(key string) {
	l.mu.Lock()
	l.until[key] = l.now().Add(autoLock())
	delete(l.reported, key)
	l.mu.Unlock()
}

// Lock relocks key, or everything when key is empty.
func (l *Locks) Lock(key string) {
	l.mu.Lock()
	if key == "" {
		l.until = map[string]time.Time{}
	} else {
		delete(l.until, key)
	}
	l.mu.Unlock()
}

// AnyUnlocked reports whether something lockable is unlocked right now.
func (l *Locks) AnyUnlocked() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, t := range l.until {
		if l.now().Before(t) {
			return true
		}
	}
	return false
}

// Expired reports, once per expiry, whether an unlock has timed out since
// the last call.
func (l *Locks) Expired() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	changed := false
	for k, t := range l.until {
		if !l.now().Before(t) && !l.reported[k] {
			l.reported[k] = true
			changed = true
		}
	}
	return changed
}

// Redact strips locked projects' items and locked modules' items, and marks
// what is lockable and locked. It never modifies snap.
func (l *Locks) Redact(snap Snapshot) Snapshot {
	out := snap
	out.Projects = make([]Project, 0, len(snap.Projects))
	for _, p := range snap.Projects {
		pk := ProjectKey(p.Identifier)
		p.Private, p.Locked = Lockable(pk), l.Locked(pk)
		p.HiddenItems = 0
		if p.Locked {
			p.Items, p.Modules, p.Cycles, p.Labels = []Item{}, []Module{}, []Cycle{}, []Label{}
			out.Projects = append(out.Projects, p)
			continue
		}
		mods := make([]Module, len(p.Modules))
		hidden := map[string]bool{}
		for i, m := range p.Modules {
			mk := ModuleKey(m.ID)
			m.Private, m.Locked = Lockable(mk), l.Locked(mk)
			if m.Locked {
				hidden[m.ID] = true
			}
			mods[i] = m
		}
		p.Modules = mods
		if len(hidden) > 0 {
			items := make([]Item, 0, len(p.Items))
			for _, it := range p.Items {
				if slices.ContainsFunc(it.ModuleIDs, func(id string) bool { return hidden[id] }) {
					p.HiddenItems++
					continue
				}
				items = append(items, it)
			}
			p.Items = items
		}
		out.Projects = append(out.Projects, p)
	}
	return out
}

// Allowed reports whether an item (or, with itemID empty, a project) is
// visible under the current locks, judged against the full snapshot.
func (l *Locks) Allowed(snap Snapshot, projectID, itemID string) bool {
	for _, p := range snap.Projects {
		if p.ID != projectID {
			continue
		}
		if l.Locked(ProjectKey(p.Identifier)) {
			return false
		}
		if itemID == "" {
			return true
		}
		for _, it := range p.Items {
			if it.ID == itemID {
				for _, m := range it.ModuleIDs {
					if l.Locked(ModuleKey(m)) {
						return false
					}
				}
				return true
			}
		}
		return true // not synced yet: nothing to leak
	}
	return true
}
