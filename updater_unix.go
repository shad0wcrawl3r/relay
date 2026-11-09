//go:build !windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// shQuote makes s a single-quoted sh string.
func shQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// startHandOver unpacks the new .app next to the download, then runs a
// script that waits for this process to exit, swaps the bundles (putting the
// old one back if the move fails) and opens Relay again.
func startHandOver(p installPlan, file, dir string) error {
	if p.mode != modeMacApp {
		return errors.New("unsupported install")
	}
	unpacked := filepath.Join(dir, "new")
	if out, err := exec.Command("ditto", "-x", "-k", file, unpacked).CombinedOutput(); err != nil {
		return errors.New("couldn't unpack the update: " + strings.TrimSpace(string(out)))
	}
	entries, err := os.ReadDir(unpacked)
	if err != nil {
		return err
	}
	app := ""
	for _, e := range entries {
		if e.IsDir() && strings.HasSuffix(e.Name(), ".app") {
			app = filepath.Join(unpacked, e.Name())
		}
	}
	if app == "" {
		return errors.New("the update has no .app inside")
	}
	old := p.target + ".old-update"
	script := `#!/bin/sh
while kill -0 ` + strconv.Itoa(os.Getpid()) + ` 2>/dev/null; do sleep 0.3; done
APP=` + shQuote(p.target) + `
NEW=` + shQuote(app) + `
OLD=` + shQuote(old) + `
rm -rf "$OLD"
if mv "$APP" "$OLD"; then
  if mv "$NEW" "$APP"; then rm -rf "$OLD"; else mv "$OLD" "$APP"; fi
fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
open "$APP"
rm -rf ` + shQuote(dir) + `
`
	path := filepath.Join(dir, "update.sh")
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		return err
	}
	cmd := exec.Command("/bin/sh", path)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
