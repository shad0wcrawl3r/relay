package main

import "testing"

func TestBufferStaff(t *testing.T) {
	t.Setenv("RELAY_BUFFER_NOTE", "")
	for email, want := range map[string]bool{
		"jo@buffer.com":         true,
		" Jo@Buffer.COM ":       true,
		"jo@notbuffer.com":      false,
		"jo@mail.buffer.com":    false,
		"jo@buffer.com.evil.io": false,
		"buffer.com@gmail.com":  false,
		"@buffer.com":           false,
		"":                      false,
	} {
		if got := bufferStaff(email); got != want {
			t.Errorf("bufferStaff(%q) = %v, want %v", email, got, want)
		}
	}
}
