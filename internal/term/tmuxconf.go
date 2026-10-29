package term

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Actions the terminal view can bind keys to.
const (
	ActSplitRight = "split-right"
	ActSplitDown  = "split-down"
	ActFocusLeft  = "focus-left"
	ActFocusRight = "focus-right"
	ActFocusUp    = "focus-up"
	ActFocusDown  = "focus-down"
	ActZoom       = "zoom"
	ActNewTab     = "new-tab"
	ActClosePane  = "close-pane"
	ActCloseTab   = "close-tab"
	ActNextTab    = "next-tab"
	ActPrevTab    = "prev-tab"
	ActSelectTab  = "select-tab" // Arg: tab index as tmux counts (base 0)
	ActBackground = "background"
	ActBreakPane  = "break-pane"
	ActSendPrefix = "send-prefix"
)

// Binding maps a tmux-style key ("C-a", "M-Left", "%") to an action.
// Root bindings fire without the prefix (tmux bind -n).
type Binding struct {
	Key    string `json:"key"`
	Root   bool   `json:"root"`
	Action string `json:"action"`
	Arg    string `json:"arg"`
}

// Keymap is the terminal view's prefix and bindings.
type Keymap struct {
	Prefix  string `json:"prefix"`
	Prefix2 string `json:"prefix2"`
	// BaseIndex is the number of the first tab, for select-tab (tmux
	// base-index).
	BaseIndex int       `json:"baseIndex"`
	Bindings  []Binding `json:"bindings"`
	// Source is the tmux config that was applied; empty for the defaults.
	Source string `json:"source"`
	// Skipped lists bindings Relay can't honour, as "file:line: text".
	Skipped []string `json:"skipped"`
	Error   string   `json:"error"`
}

// DefaultKeymap mirrors tmux's own defaults for the actions Relay supports.
func DefaultKeymap() Keymap {
	b := []Binding{
		{Key: "%", Action: ActSplitRight},
		{Key: `"`, Action: ActSplitDown},
		{Key: "Left", Action: ActFocusLeft},
		{Key: "Right", Action: ActFocusRight},
		{Key: "Up", Action: ActFocusUp},
		{Key: "Down", Action: ActFocusDown},
		{Key: "z", Action: ActZoom},
		{Key: "c", Action: ActNewTab},
		{Key: "x", Action: ActClosePane},
		{Key: "&", Action: ActCloseTab},
		{Key: "n", Action: ActNextTab},
		{Key: "p", Action: ActPrevTab},
		{Key: "d", Action: ActBackground},
		{Key: "!", Action: ActBreakPane},
		{Key: "C-b", Action: ActSendPrefix},
	}
	for i := 0; i <= 9; i++ {
		b = append(b, Binding{Key: fmt.Sprint(i), Action: ActSelectTab, Arg: fmt.Sprint(i)})
	}
	return Keymap{Prefix: "C-b", Bindings: b, Skipped: []string{}}
}

// TmuxConfPaths are the places tmux looks for its config, in order.
func TmuxConfPaths(home string) []string {
	xdg := os.Getenv("XDG_CONFIG_HOME")
	if xdg == "" {
		xdg = filepath.Join(home, ".config")
	}
	return []string{
		filepath.Join(home, ".tmux.conf"),
		filepath.Join(xdg, "tmux", "tmux.conf"),
	}
}

// LoadTmuxKeymap applies the first tmux config found on top of tmux's
// defaults. Without one it returns the defaults.
func LoadTmuxKeymap(home string) Keymap {
	km := DefaultKeymap()
	for _, p := range TmuxConfPaths(home) {
		if _, err := os.Stat(p); err == nil {
			km.Source = p
			if err := km.applyFile(p, home, 0); err != nil {
				km.Error = err.Error()
			}
			break
		}
	}
	return km
}

func (km *Keymap) applyFile(path, home string, depth int) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return km.apply(f, path, home, depth)
}

func (km *Keymap) apply(r io.Reader, path, home string, depth int) error {
	sc := bufio.NewScanner(r)
	n, start := 0, 0
	var pending string
	for sc.Scan() {
		n++
		line := sc.Text()
		if pending == "" {
			start = n
		}
		// A trailing backslash continues the line.
		if strings.HasSuffix(line, `\`) && !strings.HasSuffix(line, `\\`) {
			pending += strings.TrimSuffix(line, `\`) + " "
			continue
		}
		line, pending = pending+line, ""
		km.line(line, fmt.Sprintf("%s:%d", filepath.Base(path), start), path, home, depth)
	}
	return sc.Err()
}

func (km *Keymap) skip(where, line string) {
	km.Skipped = append(km.Skipped, where+": "+strings.TrimSpace(line))
}

func (km *Keymap) line(line, where, path, home string, depth int) {
	words := tokenize(line)
	if len(words) == 0 {
		return
	}
	cmd, args := words[0], words[1:]
	switch cmd {
	case "set", "set-option":
		flags, rest := splitFlags(args, "t")
		if len(rest) == 2 && rest[0] == "base-index" {
			if n, err := strconv.Atoi(rest[1]); err == nil && n >= 0 {
				km.BaseIndex = n
			}
			return
		}
		if len(rest) < 1 || (rest[0] != "prefix" && rest[0] != "prefix2") {
			return
		}
		val := ""
		if len(rest) > 1 && !strings.Contains(flags, "u") {
			val = normKey(rest[1])
		}
		if val == "None" {
			val = ""
		}
		if rest[0] == "prefix" {
			if val == "" {
				val = "C-b"
			}
			km.Prefix = val
		} else {
			km.Prefix2 = val
		}
	case "unbind", "unbind-key":
		flags, rest := splitFlags(args, "T")
		root := strings.Contains(flags, "n")
		if t := flagValue(args, "T"); t != "" {
			if t != "prefix" && t != "root" {
				return
			}
			root = t == "root"
		}
		if strings.Contains(flags, "a") {
			km.Bindings = filterBindings(km.Bindings, func(b Binding) bool { return b.Root != root })
			return
		}
		if len(rest) == 0 {
			return
		}
		key := normKey(rest[0])
		km.Bindings = filterBindings(km.Bindings, func(b Binding) bool { return b.Key != key || b.Root != root })
	case "bind", "bind-key":
		flags, rest := splitFlags(args, "TN")
		root := strings.Contains(flags, "n")
		if t := flagValue(args, "T"); t != "" {
			if t != "prefix" && t != "root" {
				return // copy-mode and custom tables
			}
			root = t == "root"
		}
		if len(rest) < 2 {
			return
		}
		key := normKey(rest[0])
		b, ok := mapCommand(rest[1:])
		if !ok {
			km.skip(where, line)
			return
		}
		b.Key, b.Root = key, root
		km.Bindings = append(filterBindings(km.Bindings, func(x Binding) bool { return x.Key != key || x.Root != root }), b)
	case "source", "source-file":
		_, rest := splitFlags(args, "")
		if depth >= 3 {
			return
		}
		for _, p := range rest {
			p = expandHome(p, home)
			if !filepath.IsAbs(p) {
				p = filepath.Join(filepath.Dir(path), p)
			}
			matches, _ := filepath.Glob(p)
			for _, m := range matches {
				if err := km.applyFile(m, home, depth+1); err != nil {
					km.skip(where, line)
				}
			}
		}
	}
}

// mapCommand maps the first command of a binding to an action. A command
// chained after it with \; is ignored.
func mapCommand(words []string) (Binding, bool) {
	cmd := words
	for i, w := range words {
		if w == ";" {
			cmd = words[:i]
			break
		}
	}
	if len(cmd) == 0 {
		return Binding{}, false
	}
	name, args := cmd[0], cmd[1:]
	flags, _ := splitFlags(args, "tcFlTnes")
	has := func(f string) bool { return strings.Contains(flags, f) }
	switch name {
	case "split-window", "splitw":
		if has("h") {
			return Binding{Action: ActSplitRight}, true
		}
		return Binding{Action: ActSplitDown}, true
	case "select-pane", "selectp":
		switch {
		case has("L"):
			return Binding{Action: ActFocusLeft}, true
		case has("R"):
			return Binding{Action: ActFocusRight}, true
		case has("U"):
			return Binding{Action: ActFocusUp}, true
		case has("D"):
			return Binding{Action: ActFocusDown}, true
		}
	case "resize-pane", "resizep":
		if has("Z") {
			return Binding{Action: ActZoom}, true
		}
	case "new-window", "neww":
		return Binding{Action: ActNewTab}, true
	case "kill-pane", "killp":
		return Binding{Action: ActClosePane}, true
	case "kill-window", "killw":
		return Binding{Action: ActCloseTab}, true
	case "next-window", "next":
		return Binding{Action: ActNextTab}, true
	case "previous-window", "prev":
		return Binding{Action: ActPrevTab}, true
	case "select-window", "selectw":
		switch {
		case has("n"):
			return Binding{Action: ActNextTab}, true
		case has("p"):
			return Binding{Action: ActPrevTab}, true
		}
		if t := strings.TrimPrefix(flagValue(args, "t"), ":"); regexp.MustCompile(`^\d+$`).MatchString(t) {
			return Binding{Action: ActSelectTab, Arg: t}, true
		}
	case "detach-client", "detach":
		return Binding{Action: ActBackground}, true
	case "break-pane", "breakp":
		return Binding{Action: ActBreakPane}, true
	case "send-prefix":
		return Binding{Action: ActSendPrefix}, true
	case "confirm-before", "confirm":
		// confirm-before -p "kill-pane #P? (y/n)" kill-pane
		_, rest := splitFlags(args, "pc")
		if len(rest) > 0 {
			return mapCommand(tokenize(strings.Join(rest, " ")))
		}
	}
	return Binding{}, false
}

// splitFlags separates leading -flags from positional words. Flags listed in
// withValue consume the next word.
func splitFlags(args []string, withValue string) (flags string, rest []string) {
	i := 0
	for ; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			i++
			break
		}
		if len(a) < 2 || a[0] != '-' {
			break
		}
		f := a[1:]
		flags += f
		if strings.ContainsAny(f[len(f)-1:], withValue) && len(f) == 1 {
			i++
		}
	}
	if i > len(args) {
		i = len(args)
	}
	return flags, args[i:]
}

func flagValue(args []string, flag string) string {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "-"+flag {
			return args[i+1]
		}
	}
	return ""
}

func filterBindings(bs []Binding, keep func(Binding) bool) []Binding {
	out := bs[:0:0]
	for _, b := range bs {
		if keep(b) {
			out = append(out, b)
		}
	}
	return out
}

func expandHome(p, home string) string {
	if p == "~" {
		return home
	}
	if strings.HasPrefix(p, "~/") {
		return filepath.Join(home, p[2:])
	}
	return os.Expand(p, func(k string) string {
		if k == "HOME" {
			return home
		}
		return os.Getenv(k)
	})
}

var keyAliases = map[string]string{
	"pageup": "PPage", "ppage": "PPage", "pgup": "PPage",
	"pagedown": "NPage", "npage": "NPage", "pgdn": "NPage",
	"escape": "Escape", "esc": "Escape", "enter": "Enter", "space": "Space", "tab": "Tab",
	"bspace": "BSpace", "home": "Home", "end": "End", "dc": "DC", "ic": "IC",
	"left": "Left", "right": "Right", "up": "Up", "down": "Down",
}

// normKey canonicalises a tmux key: modifiers ordered C-M-S-, ^x as C-x,
// named keys in tmux's spelling, and C-<letter> lower-cased.
func normKey(k string) string {
	if len(k) == 2 && k[0] == '^' {
		k = "C-" + strings.ToLower(k[1:])
	}
	var c, m, s bool
	for len(k) > 2 && k[1] == '-' {
		switch k[0] {
		case 'C', 'c':
			c = true
		case 'M', 'm':
			m = true
		case 'S', 's':
			s = true
		default:
			goto done
		}
		k = k[2:]
	}
done:
	if a, ok := keyAliases[strings.ToLower(k)]; ok {
		k = a
	} else if len(k) > 1 && (k[0] == 'F' || k[0] == 'f') && regexp.MustCompile(`^[Ff]\d{1,2}$`).MatchString(k) {
		k = "F" + k[1:]
	}
	if c && len(k) == 1 {
		k = strings.ToLower(k)
	}
	pre := ""
	if c {
		pre += "C-"
	}
	if m {
		pre += "M-"
	}
	if s {
		pre += "S-"
	}
	return pre + k
}

// tokenize splits a tmux config line into words: '#' comments, single and
// double quotes, backslash escapes, and \; as a standalone ";".
func tokenize(line string) []string {
	var words []string
	var cur strings.Builder
	inWord := false
	flush := func() {
		if inWord {
			words = append(words, cur.String())
			cur.Reset()
			inWord = false
		}
	}
	for i := 0; i < len(line); i++ {
		ch := line[i]
		switch {
		case ch == '#' && !inWord:
			flush()
			return words
		case ch == ' ' || ch == '\t':
			flush()
		case ch == '\\' && i+1 < len(line):
			i++
			if line[i] == ';' && !inWord {
				words = append(words, ";")
				continue
			}
			cur.WriteByte(line[i])
			inWord = true
		case ch == '\'' || ch == '"':
			j := strings.IndexByte(line[i+1:], ch)
			if j < 0 {
				cur.WriteString(line[i+1:])
				i = len(line)
			} else {
				cur.WriteString(line[i+1 : i+1+j])
				i += j + 1
			}
			inWord = true
		case ch == ';' && !inWord && (i+1 == len(line) || line[i+1] == ' '):
			words = append(words, ";")
		default:
			cur.WriteByte(ch)
			inWord = true
		}
	}
	flush()
	return words
}
