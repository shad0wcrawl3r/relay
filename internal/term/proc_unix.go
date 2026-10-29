//go:build !windows

package term

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	pty "github.com/aymanbagabas/go-pty"
	"golang.org/x/sys/unix"
)

func hangup(p *os.Process) error { return p.Signal(syscall.SIGHUP) }

// foreground names the PTY's foreground process group leader, e.g. "zsh" or
// "nvim".
func foreground(p pty.Pty, _ *pty.Cmd) string {
	up, ok := p.(pty.UnixPty)
	if !ok {
		return ""
	}
	pgrp, err := unix.IoctlGetInt(int(up.Master().Fd()), unix.TIOCGPGRP)
	if err != nil || pgrp <= 0 {
		return ""
	}
	out, err := exec.Command("ps", "-o", "comm=", "-p", strconv.Itoa(pgrp)).Output()
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(filepath.Base(strings.TrimSpace(string(out))), "-")
}
