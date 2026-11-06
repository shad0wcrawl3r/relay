package term

import (
	"os"
	"path/filepath"
	"strings"
)

// Shell is one shell installed on this machine that a session can run.
type Shell struct {
	// Name is what the user sees, e.g. "zsh" or "PowerShell 7".
	Name string `json:"name"`
	Path string `json:"path"`
	// Default marks the one used when none is chosen.
	Default bool `json:"default"`
}

// Shells lists the shells found on this machine, the default first.
func Shells() []Shell {
	found := detectShells()
	def := defaultShell()
	out := make([]Shell, 0, len(found))
	for _, s := range found {
		if samePath(s.Path, def) {
			s.Default = true
			out = append([]Shell{s}, out...)
		} else {
			out = append(out, s)
		}
	}
	return out
}

// Usable reports whether path names an existing file, so a shell saved on
// another machine (or since uninstalled) falls back to the default.
func Usable(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func samePath(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	ra, err1 := filepath.EvalSymlinks(a)
	rb, err2 := filepath.EvalSymlinks(b)
	if err1 != nil || err2 != nil {
		ra, rb = a, b
	}
	return strings.EqualFold(filepath.Clean(ra), filepath.Clean(rb))
}

// posix shells take -l to start as a login shell, which loads the user's
// profile (PATH and friends) the way a terminal app would.
var posix = map[string]bool{"sh": true, "bash": true, "zsh": true, "fish": true, "ksh": true, "mksh": true, "dash": true, "tcsh": true, "csh": true, "yash": true}

func shellArgs(path string) []string {
	// Either separator, so Windows paths parse the same everywhere.
	name := path[strings.LastIndexAny(path, `/\`)+1:]
	name = strings.TrimSuffix(strings.ToLower(name), ".exe")
	if posix[name] {
		return []string{"-l"}
	}
	switch name {
	case "pwsh", "powershell":
		return []string{"-NoLogo"}
	}
	return nil
}
