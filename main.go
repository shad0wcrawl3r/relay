package main

import (
	"embed"
	"log"

	"github.com/shad0wcrawl3r/relay/internal/plane"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func init() {
	application.RegisterEvent[plane.Snapshot]("plane:snapshot")
}

func main() {
	planeSvc := NewPlaneService()
	postSvc, err := NewPostService()
	if err != nil {
		log.Fatal(err)
	}
	settingsSvc := &SettingsService{plane: planeSvc, posts: postSvc}

	app := application.New(application.Options{
		Name:        "Relay",
		Description: "Plane kanban + Dev.to writing workbench",
		Services: []application.Service{
			application.NewService(planeSvc),
			application.NewService(postSvc),
			application.NewService(settingsSvc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// The designs assume 1280–1440 wide; 1100 is the narrowest the board and
	// editor still lay out cleanly.
	app.Window.NewWithOptions(application.WebviewWindowOptions{
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

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
