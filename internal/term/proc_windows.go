//go:build windows

package term

import (
	"os"

	pty "github.com/aymanbagabas/go-pty"
)

func hangup(p *os.Process) error { return p.Kill() }

// foreground is not tracked on Windows yet; ConPTY has no process group.
func foreground(pty.Pty, *pty.Cmd) string { return "" }
