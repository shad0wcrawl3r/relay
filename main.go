package main

import (
	"embed"
	"log"
	"os"
	"runtime"
	"sync/atomic"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
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
	application.RegisterEvent[Integrations]("integrations:changed")
	application.RegisterEvent[string]("guide:show")
	application.RegisterEvent[string]("buffer:signin")
	application.RegisterEvent[UpdateInfo]("update:available")
	application.RegisterEvent[UpdateProgress]("update:progress")
}

// quitting is set just before Relay quits for real, so closing the window
// (which normally hides it to the tray) lets it go.
var quitting atomic.Bool

// quit ends Relay, terminal sessions included. App.Quit skips ShouldQuit, so
// mark the quit here for the close hook.
func quit() {
	quitting.Store(true)
	application.Get().Quit()
}

func main() {
	// `relay --clear-data`: used by the Windows uninstaller and by "Clear all
	// data", which runs it again after Relay quits. Nothing else starts.
	if clearDataCommand(os.Args[1:]) {
		return
	}
	// Before anything reads a secret; also moves old ones out of config.toml.
	config.LoadSecrets()
	cfg := config.GetConfig()
	logs.Configure(cfg.Logs.Enabled, cfg.Logs.Levels)
	logs.For("app").Notice("started", "os", runtime.GOOS)

	planeSvc := NewPlaneService()
	postSvc, err := NewPostService()
	if err != nil {
		log.Fatal(err)
	}
	bufferSvc := NewBufferService(postSvc, planeSvc)
	planeSvc.plan = newBufferPlan(bufferSvc.client)
	guide := &GuideService{}
	settingsSvc := &SettingsService{plane: planeSvc, posts: postSvc, buffer: bufferSvc}

	// Closing the window hides Relay to the tray; only Quit ends it (and
	// with it the terminal sessions).
	// Set once the window exists; a second launch brings it forward.
	var window *application.WebviewWindow

	app := application.New(application.Options{
		Name:        "Relay",
		Description: "Plane kanban, Dev.to writing and terminal workbench",
		Services: []application.Service{
			application.NewService(planeSvc),
			application.NewService(postSvc),
			application.NewService(bufferSvc),
			application.NewService(NewAIService(postSvc)),
			application.NewService(&LogService{}),
			application.NewService(settingsSvc),
			application.NewService(NewTerminalService()),
			application.NewService(guide),
			application.NewService(NewUpdateService()),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		// ⌘Q and the tray's Quit both end up here.
		// One Relay per user: a second launch (Start menu, Dock, a double
		// click while it's in the tray) shows this one and exits, instead of
		// running a second set of terminal sessions, syncs and token
		// refreshes against the same files and keychain entries.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: instanceID(),
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				logs.For("app").Info("second launch; showing this instance")
				if window != nil {
					window.Show()
					window.Focus()
				}
			},
		},
		ShouldQuit: func() bool {
			logs.For("app").Notice("quitting")
			quitting.Store(true)
			return true
		},
	})

	// The designs assume 1280–1440 wide; 1100 is the narrowest the board and
	// editor still lay out cleanly.
	window = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     windowTitle("Relay"),
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

	openAbout := func() {
		show()
		app.Event.Emit("app:navigate", map[string]string{"name": "settings", "tab": "about"})
	}
	app.Menu.SetApplicationMenu(applicationMenu(openAbout))

	menu := application.NewMenu()
	// Version and build at a glance; About has the rest.
	menu.Add(trayVersion()).SetEnabled(false)
	menu.Add("About Relay…").OnClick(func(*application.Context) { openAbout() })
	menu.AddSeparator()
	toggle := menu.Add("Hide Relay")
	toggle.OnClick(func(*application.Context) {
		if window.IsVisible() {
			window.Hide()
		} else {
			show()
		}
	})
	menu.AddSeparator()
	menu.Add("Quit Relay").OnClick(func(*application.Context) { quit() })
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

	// First run: the setup guide floats beside the main window until it's
	// finished or skipped.
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		if !guide.Status().Done {
			guide.Open()
		}
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// instanceID names the single-instance lock. Dev builds get their own, so
// `wails3 dev` still starts while an installed Relay is running.
func instanceID() string {
	if releaseBuild {
		return "dev.shadowcrawler.relay"
	}
	return "dev.shadowcrawler.relay.dev"
}
