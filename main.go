package main

import (
	"embed"
	"log"
	"runtime"
	"sync/atomic"

	"github.com/shad0wcrawl3r/relay/internal/plane"
	"github.com/shad0wcrawl3r/relay/internal/term"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

// Menu-bar icon: a template (black + alpha) that macOS tints for light and
// dark menu bars; the colour icon is for Windows and Linux trays.
//
//go:embed build/tray-template.png
var trayTemplate []byte

//go:embed build/tray-color.png
var trayColor []byte

func init() {
	application.RegisterEvent[plane.Snapshot]("plane:snapshot")
	application.RegisterEvent[[]term.Info]("term:sessions")
}

func main() {
	planeSvc := NewPlaneService()
	postSvc, err := NewPostService()
	if err != nil {
		log.Fatal(err)
	}
	settingsSvc := &SettingsService{plane: planeSvc, posts: postSvc}

	// Closing the window hides Relay to the tray; only Quit ends it (and
	// with it the terminal sessions).
	var quitting atomic.Bool

	app := application.New(application.Options{
		Name:        "Relay",
		Description: "Plane kanban, Dev.to writing and terminal workbench",
		Services: []application.Service{
			application.NewService(planeSvc),
			application.NewService(postSvc),
			application.NewService(NewBufferService(postSvc)),
			application.NewService(NewAIService(postSvc)),
			application.NewService(settingsSvc),
			application.NewService(NewTerminalService()),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		// ⌘Q and the tray's Quit both end up here.
		ShouldQuit: func() bool {
			quitting.Store(true)
			return true
		},
	})

	// The designs assume 1280–1440 wide; 1100 is the narrowest the board and
	// editor still lay out cleanly.
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "Relay",
		Width:     1440,
		Height:    900,
		MinWidth:  1100,
		MinHeight: 680,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 44,
			Backdrop:                application.MacBackdropNormal,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(9, 9, 11),
		URL:              "/",
	})

	window.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if quitting.Load() {
			return
		}
		e.Cancel()
		window.Hide()
	})
	show := func() {
		window.Show()
		window.Focus()
	}
	// Clicking the Dock icon brings a hidden window back.
	app.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen, func(*application.ApplicationEvent) { show() })

	menu := application.NewMenu()
	toggle := menu.Add("Hide Relay")
	toggle.OnClick(func(*application.Context) {
		if window.IsVisible() {
			window.Hide()
		} else {
			show()
		}
	})
	menu.AddSeparator()
	// App.Quit skips ShouldQuit, so mark the quit here for the close hook.
	menu.Add("Quit Relay").OnClick(func(*application.Context) {
		quitting.Store(true)
		app.Quit()
	})
	label := func(visible bool) {
		if visible {
			toggle.SetLabel("Hide Relay")
		} else {
			toggle.SetLabel("Show Relay")
		}
		menu.Update()
	}
	window.OnWindowEvent(events.Common.WindowShow, func(*application.WindowEvent) { label(true) })
	window.OnWindowEvent(events.Common.WindowHide, func(*application.WindowEvent) { label(false) })

	tray := app.SystemTray.New()
	tray.SetTooltip("Relay is running")
	if runtime.GOOS == "darwin" {
		tray.SetTemplateIcon(trayTemplate)
	} else {
		tray.SetIcon(trayColor)
	}
	tray.SetMenu(menu)

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
