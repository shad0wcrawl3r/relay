//go:build production

package main

// releaseBuild is true for release builds (wails3 build / task package),
// which pass -tags production.
const releaseBuild = true
