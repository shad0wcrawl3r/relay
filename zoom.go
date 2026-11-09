package main

import (
	"math"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Page zoom for every Relay window: ⌘/Ctrl + and - step through these
// levels, ⌘/Ctrl 0 resets. The webview's own page zoom re-lays out the
// page (it doesn't just magnify), so the terminal refits as well.

const (
	minZoom = 0.5
	maxZoom = 2.0
)

func clampZoom(z float64) float64 {
	if math.IsNaN(z) || z <= 0 {
		return 1
	}
	return math.Round(math.Min(maxZoom, math.Max(minZoom, z))*100) / 100
}

func applyZoom(z float64) {
	app := application.Get()
	if app == nil {
		return
	}
	for _, w := range app.Window.GetAll() {
		w.SetZoom(z)
	}
}

// Zoom is the saved zoom level.
func (s *SettingsService) Zoom() float64 { return clampZoom(config.GetConfig().Appearance.Zoom) }

// ApplyZoom applies the saved zoom to every window; a window calls it once
// its page has loaded.
func (s *SettingsService) ApplyZoom() float64 {
	z := s.Zoom()
	applyZoom(z)
	return z
}

// SetZoom saves and applies a zoom level, clamped to 50–200%.
func (s *SettingsService) SetZoom(z float64) (float64, error) {
	z = clampZoom(z)
	if err := config.Update(func(c *config.Config) { c.Appearance.Zoom = z }); err != nil {
		return 0, err
	}
	applyZoom(z)
	return z, nil
}
