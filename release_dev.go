//go:build !production

package main

// releaseBuild is false under wails3 dev, go run, go build and go test.
const releaseBuild = false
