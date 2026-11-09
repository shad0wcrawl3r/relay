//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
)

// psQuote makes s a single-quoted PowerShell string.
func psQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// startHandOver writes a PowerShell script that waits for this process to
// exit, installs the update and starts Relay again, and runs it detached.
func startHandOver(p installPlan, file, dir string) error {
	pid := strconv.Itoa(os.Getpid())
	var body string
	switch p.mode {
	case modeWindowsInstaller:
		// /D must come last and unquoted, even with spaces. If the UAC prompt
		// is declined the old version starts again.
		body = `
try { Start-Process -FilePath ` + psQuote(file) + ` -ArgumentList '/S', ` + psQuote("/D="+p.target) + ` -Verb RunAs -Wait } catch { }
Start-Process -FilePath ` + psQuote(p.exe)
	case modeWindowsPortable:
		// A running exe can't be overwritten, but this one has exited by now.
		body = `
for ($i = 0; $i -lt 20; $i++) {
  try { Move-Item -LiteralPath ` + psQuote(file) + ` -Destination ` + psQuote(p.exe) + ` -Force; break } catch { Start-Sleep -Milliseconds 500 }
}
Start-Process -FilePath ` + psQuote(p.exe)
	default:
		return errors.New("unsupported install")
	}
	script := `$ErrorActionPreference = 'Continue'
try { Wait-Process -Id ` + pid + ` -Timeout 60 } catch { }
Start-Sleep -Milliseconds 500` + body + `
Start-Sleep -Seconds 5
Remove-Item -LiteralPath ` + psQuote(dir) + ` -Recurse -Force -ErrorAction SilentlyContinue
`
	path := filepath.Join(dir, "update.ps1")
	if err := os.WriteFile(path, []byte(script), 0o600); err != nil {
		return err
	}
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", path)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS,
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
