//go:build !windows

package term

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func defaultShell() string {
	if s := os.Getenv("SHELL"); Usable(s) {
		return s
	}
	for _, s := range []string{"/bin/zsh", "/bin/bash", "/bin/sh"} {
		if Usable(s) {
			return s
		}
	}
	return "/bin/sh"
}

// detectShells reads /etc/shells, the system's list of login shells, and
// keeps the ones that exist. $SHELL is added when it isn't listed.
func detectShells() []Shell {
	var paths []string
	if f, err := os.Open("/etc/shells"); err == nil {
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line != "" && !strings.HasPrefix(line, "#") {
				paths = append(paths, line)
			}
		}
		f.Close()
	}
	paths = append(paths, os.Getenv("SHELL"))
	// Shells from a package manager are often missing from /etc/shells.
	for _, name := range []string{"bash", "zsh", "fish", "nu"} {
		if p, err := exec.LookPath(name); err == nil {
			paths = append(paths, p)
		}
	}
	var out []Shell
	seen := map[string]bool{}
	for _, p := range paths {
		if !Usable(p) {
			continue
		}
		real, err := filepath.EvalSymlinks(p)
		if err != nil {
			real = p
		}
		if seen[real] {
			continue
		}
		seen[real] = true
		out = append(out, Shell{Name: filepath.Base(p), Path: p})
	}
	return out
}
