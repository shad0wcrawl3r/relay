package main

import (
	"context"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/plane"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// PlaneService exposes the Plane workspace to the frontend. It polls on the
// configured interval and pushes each snapshot as a "plane:snapshot" event.
type PlaneService struct {
	client *plane.Client
	app    *application.App

	syncMu sync.Mutex
	kick   chan struct{}
}

func NewPlaneService() *PlaneService {
	return &PlaneService{client: plane.New(), kick: make(chan struct{}, 1)}
}

func (s *PlaneService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.app = application.Get()
	go s.poll(ctx)
	return nil
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
	snap, _ := s.client.Sync(ctx, force)
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
	return snap
}

// SyncNow fetches everything immediately and returns the result.
func (s *PlaneService) SyncNow(ctx context.Context) plane.Snapshot {
	return s.sync(ctx, false)
}

func (s *PlaneService) Connect(ctx context.Context) error {
	err := s.client.Connect(ctx, func(u string) { _ = s.app.Browser.OpenURL(u) })
	if err != nil {
		return err
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

func (s *PlaneService) Detail(ctx context.Context, projectID, itemID string) (plane.ItemDetail, error) {
	return s.client.Detail(ctx, projectID, itemID)
}

func (s *PlaneService) Update(ctx context.Context, projectID, itemID string, patch plane.ItemPatch) error {
	if err := s.client.Update(ctx, projectID, itemID, patch); err != nil {
		return err
	}
	s.resync()
	return nil
}

func (s *PlaneService) Create(ctx context.Context, item plane.NewItem) (plane.Item, error) {
	it, err := s.client.Create(ctx, item)
	if err != nil {
		return plane.Item{}, err
	}
	s.resync()
	return it, nil
}

func (s *PlaneService) Comment(ctx context.Context, projectID, itemID, html string) error {
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
