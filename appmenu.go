package main

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// applicationMenu is Wails' default menu bar with two changes: the macOS
// app menu has no About item (it opened the standard about panel), and Help
// holds "About Relay", which opens Settings → About, instead of "Learn
// More", which loaded the Wails website into the window with no way back.
func applicationMenu(openAbout func()) *application.Menu {
	menu := application.NewMenu()
	if runtime.GOOS == "darwin" {
		app := menu.AddSubmenu("Relay")
		app.AddRole(application.ServicesMenu)
		app.AddSeparator()
		app.AddRole(application.Hide)
		app.AddRole(application.HideOthers)
		app.AddRole(application.UnHide)
		app.AddSeparator()
		app.AddRole(application.Quit)
	}
	menu.AddRole(application.FileMenu)
	menu.AddRole(application.EditMenu)
	menu.AddRole(application.ViewMenu)
	menu.AddRole(application.WindowMenu)
	help := menu.AddSubmenu("Help")
	help.Add("About Relay").OnClick(func(*application.Context) { openAbout() })
	return menu
}
