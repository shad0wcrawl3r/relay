package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// The update check asks GitHub's public releases API whether a newer Relay
// is out and offers its release page. It never downloads or installs
// anything, and sends GitHub nothing but the request itself.

// The version comes from build/config.yml, the same file the build stamps
// into the bundles, so there's one place to bump it.
//
//go:embed build/config.yml
var buildConfig string

const releasesAPI = "https://api.github.com/repos/shad0wcrawl3r/relay/releases?per_page=20"

var versionLine = regexp.MustCompile(`(?m)^\s+version:\s*"([^"]+)"`)

// appVersion is the version under info: in build/config.yml.
func appVersion() string {
	if m := versionLine.FindStringSubmatch(buildConfig); m != nil {
		return m[1]
	}
	return "0.0.0"
}

// UpdateInfo is what the last check found.
type UpdateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	// URL is the newer release's page; empty when there's none.
	URL       string `json:"url"`
	CheckedAt string `json:"checkedAt"`
	// CanInstall: Relay can download and install this update itself
	// (release builds on Windows and macOS).
	CanInstall bool `json:"canInstall"`
}

type UpdateStatus struct {
	Current string `json:"current"`
	// Display is the version to show: Current, or the commit in dev builds.
	Display string `json:"display"`
	// Dev: not a release build (wails3 dev, go run, go build).
	Dev bool `json:"dev"`
	// AutoCheck: check when a release build starts.
	AutoCheck bool `json:"autoCheck"`
	// Last is the most recent check this session, if any.
	Last *UpdateInfo `json:"last"`
}

type UpdateService struct {
	http *http.Client
	api  string

	mu   sync.Mutex
	last *UpdateInfo
	// assets of the newer release in last, by file name.
	assets     map[string]ghAsset
	installing bool
}

func NewUpdateService() *UpdateService {
	return &UpdateService{http: &http.Client{Timeout: 15 * time.Second}, api: releasesAPI}
}

// ServiceStartup checks once, shortly after launch, in release builds with
// the setting on. Dev builds carry whatever version is in the file, so
// they'd nag; they can still check from Settings.
func (s *UpdateService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	if !releaseBuild || !config.GetConfig().Updates.Check {
		return nil
	}
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
		info, err := s.Check(ctx)
		if err != nil {
			return // logged in Check; a launch check fails quietly
		}
		if info.Available {
			application.Get().Event.Emit("update:available", info)
		}
	}()
	return nil
}

func (s *UpdateService) Status() UpdateStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return UpdateStatus{Current: appVersion(), Display: buildInfo().Display, Dev: !releaseBuild, AutoCheck: config.GetConfig().Updates.Check, Last: s.last}
}

func (s *UpdateService) SetAutoCheck(on bool) (UpdateStatus, error) {
	if err := config.Update(func(c *config.Config) { c.Updates.Check = on }); err != nil {
		return UpdateStatus{}, err
	}
	return s.Status(), nil
}

type ghRelease struct {
	TagName string    `json:"tag_name"`
	HTMLURL string    `json:"html_url"`
	Draft   bool      `json:"draft"`
	Assets  []ghAsset `json:"assets"`
}

type ghAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
	Size int64  `json:"size"`
}

// Check asks GitHub for the newest published release, pre-releases
// included (every Relay release so far is one).
func (s *UpdateService) Check(ctx context.Context) (UpdateInfo, error) {
	log := logs.For("update")
	current := appVersion()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.api, nil)
	if err != nil {
		return UpdateInfo{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Relay/"+current)
	resp, err := s.http.Do(req)
	if err != nil {
		log.Warn("check failed", "err", err)
		return UpdateInfo{}, errors.New("couldn't reach GitHub to check for updates")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Warn("check failed", "status", resp.StatusCode)
		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
			return UpdateInfo{}, errors.New("GitHub is limiting requests from this network; try again in an hour")
		}
		return UpdateInfo{}, fmt.Errorf("GitHub answered %s", resp.Status)
	}
	var releases []ghRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&releases); err != nil {
		return UpdateInfo{}, errors.New("couldn't read GitHub's list of releases")
	}
	info := UpdateInfo{Current: current, Latest: current, CheckedAt: time.Now().Format(time.RFC3339)}
	var assets []ghAsset
	for _, r := range releases {
		if r.Draft {
			continue
		}
		v := strings.TrimPrefix(r.TagName, "v")
		if newer(v, info.Latest) {
			info.Latest, info.URL, assets = v, r.HTMLURL, r.Assets
		}
	}
	info.Available = info.URL != ""
	byName := map[string]ghAsset{}
	for _, a := range assets {
		byName[a.Name] = a
	}
	if info.Available && releaseBuild {
		if plan, err := planInstall(byName); err == nil && plan.asset.URL != "" {
			info.CanInstall = true
		}
	}
	log.Info("checked", "current", current, "latest", info.Latest, "can_install", info.CanInstall)
	s.mu.Lock()
	s.last = &info
	s.assets = byName
	s.mu.Unlock()
	return info, nil
}

// newer reports whether version a is later than b. Versions are
// MAJOR.MINOR.PATCH with an optional -suffix; a suffixed version comes
// before the same version without one. Anything unparsable is never newer.
func newer(a, b string) bool {
	pa, sa, ok := parseVersion(a)
	if !ok {
		return false
	}
	pb, sb, ok := parseVersion(b)
	if !ok {
		return true
	}
	for i := range pa {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return sa == "" && sb != ""
}

func parseVersion(v string) ([3]int, string, bool) {
	var out [3]int
	v, suffix, _ := strings.Cut(v, "-")
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, "", false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, "", false
		}
		out[i] = n
	}
	return out, suffix, true
}

// windowTitle marks dev builds in the title bar and taskbar, where the
// in-window "Dev mode" tag can't be seen.
func windowTitle(title string) string {
	if releaseBuild {
		return title
	}
	return title + " (dev)"
}
