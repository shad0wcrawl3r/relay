package main

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/shad0wcrawl3r/relay/internal/plane"
	"github.com/shad0wcrawl3r/relay/internal/unlock"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Plane logs carry counts and errors only; project content, and lock names in
// particular, never reach them.
var (
	planeLog   = logs.For("plane")
	privacyLog = logs.For("privacy")
)

// PlaneService exposes the Plane workspace to the frontend. It polls on the
// configured interval and pushes each snapshot as a "plane:snapshot" event.
type PlaneService struct {
	client *plane.Client
	app    *application.App
	locks  *plane.Locks

	syncMu sync.Mutex
	kick   chan struct{}
}

func NewPlaneService() *PlaneService {
	return &PlaneService{client: plane.New(), locks: plane.NewLocks(), kick: make(chan struct{}, 1)}
}

func (s *PlaneService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.app = application.Get()
	// Show the last synced board right away; the first poll replaces it.
	s.client.LoadCache()
	go s.poll(ctx)
	go s.watchLocks(ctx)
	return nil
}

// watchLocks re-sends the snapshot when an unlock times out, so locked
// content leaves the screen.
func (s *PlaneService) watchLocks(ctx context.Context) {
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if s.locks.Expired() {
				privacyLog.Info("unlock expired")
				s.emit()
			}
		}
	}
}

func (s *PlaneService) emit() {
	if s.app != nil {
		s.app.Event.Emit("plane:snapshot", s.Snapshot())
	}
}

func (s *PlaneService) poll(ctx context.Context) {
	for {
		s.sync(ctx, false)
		interval := time.Duration(config.GetConfig().Sync.IntervalSeconds) * time.Second
		if interval < 30*time.Second {
			interval = 30 * time.Second
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		case <-s.kick:
		}
	}
}

func (s *PlaneService) sync(ctx context.Context, force bool) plane.Snapshot {
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	snap, err := s.client.Sync(ctx, force)
	if err != nil {
		planeLog.Warn("sync failed", "error", err)
	} else {
		planeLog.Debug("synced", "forced", force)
	}
	snap = s.locks.Redact(snap)
	if s.app != nil {
		s.app.Event.Emit("plane:snapshot", snap)
	}
	return snap
}

// Snapshot returns the last synced state without a network round trip.
func (s *PlaneService) Snapshot() plane.Snapshot {
	snap := s.client.Last()
	snap.Connected = s.client.Connected()
	snap.Workspace = s.client.Workspace()
	snap.AppURL = plane.AppURL()
	return s.locks.Redact(snap)
}

// SyncNow fetches everything immediately and returns the result.
func (s *PlaneService) SyncNow(ctx context.Context) plane.Snapshot {
	return s.sync(ctx, false)
}

func (s *PlaneService) Connect(ctx context.Context) error {
	err := s.client.Connect(ctx, func(u string) { _ = s.app.Browser.OpenURL(u) })
	if err != nil {
		planeLog.Warn("connect failed", "error", err)
		return err
	}
	planeLog.Notice("connected")
	// Tell every view now: the first full sync can take a while, and a view
	// reloaded during sign-in (dev server) no longer holds this call.
	if s.app != nil {
		snap := s.Snapshot()
		snap.Syncing = true
		s.app.Event.Emit("plane:snapshot", snap)
	}
	go s.sync(context.Background(), true)
	return nil
}

func (s *PlaneService) Disconnect() error {
	err := s.client.Disconnect()
	if s.app != nil {
		s.app.Event.Emit("plane:snapshot", s.Snapshot())
	}
	return err
}

// allowed is false for items in locked projects or modules.
func (s *PlaneService) allowed(projectID, itemID string) bool {
	return s.locks.Allowed(s.client.Last(), projectID, itemID)
}

func (s *PlaneService) Detail(ctx context.Context, projectID, itemID string) (plane.ItemDetail, error) {
	if !s.allowed(projectID, itemID) {
		return plane.ItemDetail{}, plane.ErrLocked
	}
	return s.client.Detail(ctx, projectID, itemID)
}

func (s *PlaneService) Update(ctx context.Context, projectID, itemID string, patch plane.ItemPatch) error {
	if !s.allowed(projectID, itemID) {
		return plane.ErrLocked
	}
	if err := s.client.Update(ctx, projectID, itemID, patch); err != nil {
		return err
	}
	s.resync()
	return nil
}

func (s *PlaneService) Create(ctx context.Context, item plane.NewItem) (plane.Item, error) {
	if !s.allowed(item.ProjectID, "") {
		return plane.Item{}, plane.ErrLocked
	}
	it, err := s.client.Create(ctx, item)
	if err != nil {
		return plane.Item{}, err
	}
	s.resync()
	return it, nil
}

func (s *PlaneService) Comment(ctx context.Context, projectID, itemID, html string) error {
	if !s.allowed(projectID, itemID) {
		return plane.ErrLocked
	}
	if err := s.client.Comment(ctx, projectID, itemID, html); err != nil {
		return err
	}
	s.resync()
	return nil
}

// resync asks the poller for an early sync after a write.
func (s *PlaneService) resync() {
	select {
	case s.kick <- struct{}{}:
	default:
	}
}

// UnlockMethod says how Unlock will verify the user (Touch ID, password…).
func (s *PlaneService) UnlockMethod() unlock.Method { return unlock.Available() }

// Unlock shows a locked project ("project:<IDENTIFIER>") or module
// ("module:<id>") after the OS confirms the device owner.
func (s *PlaneService) Unlock(key string) error {
	if !plane.Lockable(key) {
		return nil
	}
	if err := unlock.Authenticate("show " + s.lockName(key)); err != nil {
		privacyLog.Notice("unlock refused")
		return err
	}
	privacyLog.Notice("unlocked")
	s.locks.Unlock(key)
	s.emit()
	return nil
}

// Lock hides key again; an empty key locks everything.
func (s *PlaneService) Lock(key string) {
	privacyLog.Info("locked")
	s.locks.Lock(key)
	s.emit()
}

// SetLockable adds key to or removes it from the locked list. Removing a lock
// needs the same confirmation as unlocking.
func (s *PlaneService) SetLockable(key string, locked bool) error {
	if !strings.HasPrefix(key, "project:") && !strings.HasPrefix(key, "module:") {
		return fmt.Errorf("not a lockable key: %q", key)
	}
	if !locked && plane.Lockable(key) && s.locks.Locked(key) {
		if err := unlock.Authenticate("stop locking " + s.lockName(key)); err != nil {
			return err
		}
	}
	err := config.Update(func(c *config.Config) {
		list := slices.DeleteFunc(slices.Clone(c.Privacy.Locked), func(k string) bool { return k == key })
		if locked {
			list = append(list, key)
		}
		c.Privacy.Locked = list
	})
	if err != nil {
		return err
	}
	if locked {
		s.locks.Lock(key)
	}
	s.emit()
	return nil
}

// lockName is the project or module name for the system prompt.
func (s *PlaneService) lockName(key string) string {
	snap := s.client.Last()
	for _, p := range snap.Projects {
		if key == plane.ProjectKey(p.Identifier) {
			return "the locked project " + p.Name
		}
		for _, m := range p.Modules {
			if key == plane.ModuleKey(m.ID) {
				return "the locked module " + m.Name
			}
		}
	}
	return "locked Plane items"
}
