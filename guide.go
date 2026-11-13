package main

import (
	"runtime"
	"strings"
	"sync"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// The setup guide is a small window that floats above other apps, browser
// included, so its steps stay in view while the user creates OAuth apps or
// copies API keys. It opens on first run until finished or skipped, and
// again from Settings. Progress isn't stored: each step checks whether its
// service is already set up.

const (
	guideWidth  = 400
	guideHeight = 640
	guideMargin = 24
)

type GuideService struct {
	mu     sync.Mutex
	window *application.WebviewWindow
}

// GuideStatus is whether the user has finished or skipped the guide.
type GuideStatus struct {
	Done bool `json:"done"`
}

func (g *GuideService) Status() GuideStatus {
	return GuideStatus{Done: config.GetConfig().Onboarding.Done}
}

// Open shows the guide, or brings it forward if it's already open.
func (g *GuideService) Open() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.window != nil {
		g.window.Show()
		g.window.Focus()
		return
	}
	app := application.Get()
	if app == nil {
		return
	}
	opts := application.WebviewWindowOptions{
		Name:             "guide",
		Title:            windowTitle("Set up Relay"),
		Width:            guideWidth,
		Height:           guideHeight,
		MinWidth:         360,
		MinHeight:        480,
		AlwaysOnTop:      true,
		BackgroundColour: application.NewRGB(9, 9, 11),
		URL:              "/?window=guide",
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 36,
			Backdrop:                application.MacBackdropNormal,
			TitleBar:                application.MacTitleBarHiddenInset,
			WindowLevel:             application.MacWindowLevelFloating,
			// Follow the user into a full-screen browser and across Spaces.
			CollectionBehavior: application.MacWindowCollectionBehaviorCanJoinAllSpaces |
				application.MacWindowCollectionBehaviorFullScreenAuxiliary,
		},
	}
	// Tiling window managers (Niri, Sway, i3) tile a normal window beside
	// Relay but float one with a fixed size, as they do dialogs; Wails can't
	// mark the guide transient for the main window, so fix its size there
	// (RELAY-145).
	if runtime.GOOS == "linux" {
		opts.MinWidth, opts.MinHeight = guideWidth, guideHeight
		opts.MaxWidth, opts.MaxHeight = guideWidth, guideHeight
		opts.DisableResize = true
	}
	// Top right of the primary screen, clear of a browser's content.
	if s := app.Screen.GetPrimary(); s != nil && s.WorkArea.Width > guideWidth+2*guideMargin {
		opts.InitialPosition = application.WindowXY
		opts.X = s.WorkArea.Width - guideWidth - guideMargin
		opts.Y = guideMargin
	}
	w := app.Window.NewWithOptions(opts)
	w.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		g.mu.Lock()
		g.window = nil
		g.mu.Unlock()
	})
	g.window = w
	logs.For("app").Info("setup guide opened")
}

// Close hides the guide without finishing it; it comes back next launch.
func (g *GuideService) Close() {
	g.mu.Lock()
	w := g.window
	g.mu.Unlock()
	if w != nil {
		w.Close()
	}
}

// Finish marks the guide done (finished or skipped) and closes it.
func (g *GuideService) Finish() error {
	if err := config.Update(func(c *config.Config) { c.Onboarding.Done = true }); err != nil {
		return err
	}
	logs.For("app").Info("setup guide finished")
	g.Close()
	return nil
}

// Show brings the main window forward on a view, for the guide's last step.
// view is one of the main window's route names.
func (g *GuideService) Show(view string) {
	app := application.Get()
	if app == nil {
		return
	}
	switch view = strings.TrimSpace(view); view {
	case "editor", "buffer", "attention", "terminal", "settings":
	default:
		view = "editor"
	}
	app.Event.Emit("guide:show", view)
	if w, ok := app.Window.GetByName("main"); ok {
		w.Show()
		w.Focus()
	}
}
