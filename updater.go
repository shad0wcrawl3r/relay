package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Self-update: download the new release's file for this platform, check it
// against the release's SHA256SUMS, then hand over to a small script that
// waits for Relay to quit, puts the new version in place and starts it.
//
//   - Windows, installed: runs the NSIS installer silently into the same
//     folder (one UAC prompt, as for any install there).
//   - Windows, portable relay.exe: replaces the file.
//   - macOS: replaces the .app bundle.
//
// Linux isn't covered yet (.deb needs root; the tarball has no fixed place),
// so it gets the release page instead. Builds aren't signed: the checksum
// guards against a broken or truncated download, not a hostile GitHub.

const maxUpdateBytes = 500 << 20

// UpdateProgress is sent as "update:progress" while downloading.
type UpdateProgress struct {
	Done  int64 `json:"done"`
	Total int64 `json:"total"`
}

type installMode int

const (
	modeWindowsInstaller installMode = iota + 1
	modeWindowsPortable
	modeMacApp
)

type installPlan struct {
	mode  installMode
	asset ghAsset
	// target is what gets replaced: the install folder, relay.exe, or the
	// .app bundle.
	target string
	exe    string
}

// planInstall works out how this copy of Relay updates and which release
// file it needs. assets may be nil to check support only.
func planInstall(assets map[string]ghAsset) (installPlan, error) {
	exe, err := os.Executable()
	if err != nil {
		return installPlan{}, err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	switch runtime.GOOS {
	case "windows":
		dir := filepath.Dir(exe)
		if _, err := os.Stat(filepath.Join(dir, "uninstall.exe")); err == nil {
			p := installPlan{mode: modeWindowsInstaller, target: dir, exe: exe}
			for name, a := range assets {
				if strings.HasSuffix(name, "-installer.exe") && strings.Contains(name, runtime.GOARCH) {
					p.asset = a
				}
			}
			return p, nil
		}
		return installPlan{mode: modeWindowsPortable, target: exe, exe: exe, asset: assets["relay.exe"]}, nil
	case "darwin":
		app := appBundle(exe)
		if app == "" {
			return installPlan{}, errors.New("Relay isn't running from an .app bundle")
		}
		if !writable(filepath.Dir(app)) {
			return installPlan{}, fmt.Errorf("can't write to %s", filepath.Dir(app))
		}
		return installPlan{mode: modeMacApp, target: app, exe: exe, asset: assets["relay-macos-"+runtime.GOARCH+".zip"]}, nil
	}
	return installPlan{}, errors.New("updating itself isn't supported on this system yet")
}

// appBundle returns the .app around exe (…/Relay.app/Contents/MacOS/relay).
func appBundle(exe string) string {
	app := filepath.Dir(filepath.Dir(filepath.Dir(exe)))
	if strings.HasSuffix(app, ".app") && filepath.Base(filepath.Dir(exe)) == "MacOS" {
		return app
	}
	return ""
}

func writable(dir string) bool {
	f, err := os.CreateTemp(dir, ".relay-write-test-")
	if err != nil {
		return false
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return true
}

// Install downloads the update found by the last check, verifies it and
// starts the hand-over, then quits Relay. The new version opens by itself.
func (s *UpdateService) Install(ctx context.Context) error {
	log := logs.For("update")
	s.mu.Lock()
	last, assets := s.last, s.assets
	if s.installing {
		s.mu.Unlock()
		return errors.New("an update is already being installed")
	}
	if last == nil || !last.Available || !last.CanInstall {
		s.mu.Unlock()
		return errors.New("no update to install; check for updates first")
	}
	s.installing = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.installing = false
		s.mu.Unlock()
	}()

	plan, err := planInstall(assets)
	if err != nil {
		return err
	}
	sums, ok := assets["SHA256SUMS"]
	if !ok || plan.asset.URL == "" {
		return errors.New("this release has no file for this system")
	}
	dir, err := os.MkdirTemp("", "relay-update-")
	if err != nil {
		return err
	}
	log.Notice("downloading update", "version", last.Latest, "file", plan.asset.Name)
	file := filepath.Join(dir, plan.asset.Name)
	if err := s.download(ctx, plan.asset, file, true); err != nil {
		os.RemoveAll(dir)
		return err
	}
	sumsFile := filepath.Join(dir, "SHA256SUMS")
	if err := s.download(ctx, sums, sumsFile, false); err != nil {
		os.RemoveAll(dir)
		return err
	}
	if err := verifySum(file, sumsFile, plan.asset.Name); err != nil {
		os.RemoveAll(dir)
		log.Warn("update rejected", "err", err)
		return err
	}
	if err := startHandOver(plan, file, dir); err != nil {
		os.RemoveAll(dir)
		return err
	}
	log.Notice("installing update; quitting", "version", last.Latest)
	// Let the reply reach the frontend first.
	time.AfterFunc(300*time.Millisecond, quit)
	return nil
}

func (s *UpdateService) download(ctx context.Context, a ghAsset, dest string, progress bool) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Relay/"+appVersion())
	// The API client's timeout covers small JSON; downloads use the context.
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("couldn't download %s: %w", a.Name, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("couldn't download %s: GitHub answered %s", a.Name, resp.Status)
	}
	f, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o700)
	if err != nil {
		return err
	}
	total := resp.ContentLength
	if total <= 0 {
		total = a.Size
	}
	var w io.Writer = f
	if progress {
		w = &progressWriter{w: f, total: total}
	}
	n, err := io.Copy(w, io.LimitReader(resp.Body, maxUpdateBytes+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return fmt.Errorf("download of %s stopped: %w", a.Name, err)
	}
	if n > maxUpdateBytes {
		return fmt.Errorf("%s is larger than expected", a.Name)
	}
	return nil
}

type progressWriter struct {
	w           io.Writer
	done, total int64
	sent        time.Time
}

func (p *progressWriter) Write(b []byte) (int, error) {
	n, err := p.w.Write(b)
	p.done += int64(n)
	if time.Since(p.sent) > 200*time.Millisecond || (p.total > 0 && p.done >= p.total) {
		p.sent = time.Now()
		if app := application.Get(); app != nil {
			app.Event.Emit("update:progress", UpdateProgress{Done: p.done, Total: p.total})
		}
	}
	return n, err
}

// verifySum checks file against its line in a sha256sum-style list.
func verifySum(file, sumsFile, name string) error {
	sf, err := os.Open(sumsFile)
	if err != nil {
		return err
	}
	defer sf.Close()
	want := ""
	sc := bufio.NewScanner(sf)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == name {
			want = strings.ToLower(fields[0])
		}
	}
	if want == "" {
		return fmt.Errorf("SHA256SUMS has no entry for %s", name)
	}
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != want {
		return fmt.Errorf("the downloaded %s doesn't match its checksum; nothing was installed", name)
	}
	return nil
}
