package term

import (
	"bytes"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

// snapshot re-creates the emulator's state as a byte stream for a freshly
// reset xterm.js: scrollback, screen, cursor and the modes TUIs rely on.
// Replaying raw output instead would garble anything that redraws.
// Callers hold s.mu.
func (s *Session) snapshot() []byte {
	var b bytes.Buffer
	b.WriteString("\x1bc") // RIS: start from a clean terminal

	if s.altScreen {
		b.WriteString("\x1b[?1049h")
	} else if sb := s.emu.Scrollback(); sb != nil {
		for _, line := range sb.Lines() {
			b.WriteString(line.Render())
			b.WriteString("\x1b[0m\r\n")
		}
	}

	b.WriteString("\x1b[H\x1b[2J")
	b.WriteString(strings.ReplaceAll(strings.TrimRight(s.emu.Render(), "\n"), "\n", "\r\n"))
	b.WriteString("\x1b[0m")

	cur := s.emu.CursorPosition()
	fmt.Fprintf(&b, "\x1b[%d;%dH", cur.Y+1, cur.X+1)

	// Re-assert input modes (bracketed paste, app cursor keys, mouse, …) in a
	// stable order. 1049 is handled above, and 25 (cursor) below.
	modes := make([]ansi.Mode, 0, len(s.modes))
	for m := range s.modes {
		modes = append(modes, m)
	}
	sort.Slice(modes, func(i, j int) bool { return modes[i].Mode() < modes[j].Mode() })
	for _, m := range modes {
		switch m := m.(type) {
		case ansi.DECMode:
			if m == 1049 || m == 1047 || m == 47 || m == 25 {
				continue
			}
			fmt.Fprintf(&b, "\x1b[?%dh", int(m))
		case ansi.ANSIMode:
			fmt.Fprintf(&b, "\x1b[%dh", int(m))
		}
	}
	if s.emu.CursorHidden() {
		b.WriteString("\x1b[?25l")
	}
	return b.Bytes()
}

// cwdFromOSC7 turns "file://host/path" into "/path".
func cwdFromOSC7(v string) string {
	if u, err := url.Parse(v); err == nil && u.Scheme == "file" {
		return u.Path
	}
	return v
}
