package main

import (
	"context"
	"os/exec"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"time"
)

// Set at build time by the platform Taskfiles (-ldflags -X); empty under
// go run and go test.
var (
	buildCommit     string
	buildCommitDate string
)

// BuildInfo is what About shows.
type BuildInfo struct {
	// Version is the release version from build/config.yml.
	Version string `json:"version"`
	// Display is how the version is shown: the release version, or in dev
	// builds the commit (with "-dirty" for uncommitted changes).
	Display    string `json:"display"`
	Dev        bool   `json:"dev"`
	Commit     string `json:"commit"`
	CommitDate string `json:"commitDate"`
	Dirty      bool   `json:"dirty"`
	Go         string `json:"go"`
	Wails      string `json:"wails"`
	Platform   string `json:"platform"`
}

var (
	buildOnce sync.Once
	build     BuildInfo
)

func buildInfo() BuildInfo {
	buildOnce.Do(func() {
		build = BuildInfo{
			Version: appVersion(), Dev: !releaseBuild,
			Commit: buildCommit, CommitDate: buildCommitDate,
			Go: runtime.Version(), Platform: runtime.GOOS + "/" + runtime.GOARCH,
		}
		if bi, ok := debug.ReadBuildInfo(); ok {
			for _, d := range bi.Deps {
				if d.Path == "github.com/wailsapp/wails/v3" {
					build.Wails = d.Version
				}
			}
		}
		if build.Dev {
			// Dev builds run from the checkout, so git can say whether there
			// were uncommitted changes. Trust it only when it agrees with the
			// stamp: the working directory could be another repository.
			if c, date, dirty, ok := gitHead(); ok && (build.Commit == "" || build.Commit == c) {
				build.Commit, build.CommitDate, build.Dirty = c, date, dirty
			}
		}
		build.Display = displayVersion(build)
	})
	return build
}

func displayVersion(b BuildInfo) string {
	if !b.Dev {
		return b.Version
	}
	if b.Commit == "" {
		return "dev"
	}
	if b.Dirty {
		return b.Commit + "-dirty"
	}
	return b.Commit
}

// gitHead reads the checkout Relay is running from.
func gitHead() (commit, date string, dirty, ok bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "git", "log", "-1", "--format=%h%n%cI", "--abbrev=10").Output()
	if err != nil {
		return "", "", false, false
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) != 2 {
		return "", "", false, false
	}
	status, err := exec.CommandContext(ctx, "git", "status", "--porcelain", "--untracked-files=no").Output()
	return lines[0], lines[1], err == nil && len(strings.TrimSpace(string(status))) > 0, true
}

// Build reports the version and build details, for About.
func (s *UpdateService) Build() BuildInfo { return buildInfo() }

// trayVersion is the version line in the tray menu.
func trayVersion() string {
	b := buildInfo()
	if b.Dev {
		return "Relay dev · " + b.Display
	}
	if b.Commit != "" {
		return "Relay " + b.Version + " (" + b.Commit + ")"
	}
	return "Relay " + b.Version
}
