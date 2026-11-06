//go:build windows

package term

import (
	"os"
	"os/exec"
	"path/filepath"
)

func defaultShell() string {
	for _, s := range detectShells() {
		return s.Path
	}
	if c := os.Getenv("ComSpec"); c != "" {
		return c
	}
	return `C:\Windows\System32\cmd.exe`
}

// detectShells looks for the usual Windows shells, best first: PowerShell 7,
// Windows PowerShell, Command Prompt, then Git Bash and WSL when installed.
func detectShells() []Shell {
	var out []Shell
	seen := map[string]bool{}
	add := func(name, path string) {
		if !Usable(path) {
			return
		}
		key := filepath.Clean(path)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, Shell{Name: name, Path: path})
	}
	look := func(name, exe string) {
		if p, err := exec.LookPath(exe); err == nil {
			add(name, p)
		}
	}
	programFiles := os.Getenv("ProgramFiles")
	look("PowerShell 7", "pwsh.exe")
	add("PowerShell 7", filepath.Join(programFiles, "PowerShell", "7", "pwsh.exe"))
	root := os.Getenv("SystemRoot")
	if root == "" {
		root = `C:\Windows`
	}
	add("Windows PowerShell", filepath.Join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"))
	if c := os.Getenv("ComSpec"); c != "" {
		add("Command Prompt", c)
	} else {
		add("Command Prompt", filepath.Join(root, "System32", "cmd.exe"))
	}
	// Git Bash: the bin\bash.exe wrapper, which sets up Git's environment.
	add("Git Bash", filepath.Join(programFiles, "Git", "bin", "bash.exe"))
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		add("Git Bash", filepath.Join(local, "Programs", "Git", "bin", "bash.exe"))
	}
	add("WSL", filepath.Join(root, "System32", "wsl.exe"))
	look("Nushell", "nu.exe")
	return out
}
