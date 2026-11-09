//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

func processAlive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}

// detach puts the helper in its own session so it outlives Relay quitting.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
