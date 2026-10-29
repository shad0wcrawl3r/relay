package term

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func find(km Keymap, key string, root bool) (Binding, bool) {
	for _, b := range km.Bindings {
		if b.Key == key && b.Root == root {
			return b, true
		}
	}
	return Binding{}, false
}

func TestTmuxConf(t *testing.T) {
	home := t.TempDir()
	conf := `
# remap prefix
unbind C-b
set-option -g prefix C-a
bind-key C-a send-prefix
set -g mouse on
set -g base-index 1

bind | split-window -h -c "#{pane_current_path}"
bind - split-window -v -c '#{pane_current_path}'
unbind '"'
unbind %
bind h select-pane -L
bind -r l select-pane -R
bind -n M-Up select-pane -U
bind -T root M-Down select-pane -D
bind ^z resize-pane -Z
bind X confirm-before -p "kill pane? (y/n)" kill-pane
bind r source-file ~/.tmux.conf \; display "reloaded"
bind -T copy-mode-vi v send -X begin-selection
bind Tab select-window -t :3
source-file ~/extra.conf
`
	os.WriteFile(filepath.Join(home, ".tmux.conf"), []byte(conf), 0o600)
	os.WriteFile(filepath.Join(home, "extra.conf"), []byte("bind \\\n  T new-window\n"), 0o600)

	km := LoadTmuxKeymap(home)
	if km.Error != "" || km.Source != filepath.Join(home, ".tmux.conf") {
		t.Fatalf("source=%q err=%q", km.Source, km.Error)
	}
	if km.Prefix != "C-a" || km.BaseIndex != 1 {
		t.Errorf("prefix = %q, base-index = %d", km.Prefix, km.BaseIndex)
	}
	want := []struct {
		key    string
		root   bool
		action string
		arg    string
	}{
		{"C-a", false, ActSendPrefix, ""},
		{"|", false, ActSplitRight, ""},
		{"-", false, ActSplitDown, ""},
		{"h", false, ActFocusLeft, ""},
		{"l", false, ActFocusRight, ""},
		{"M-Up", true, ActFocusUp, ""},
		{"M-Down", true, ActFocusDown, ""},
		{"C-z", false, ActZoom, ""},
		{"X", false, ActClosePane, ""},
		{"Tab", false, ActSelectTab, "3"},
		{"T", false, ActNewTab, ""},
		{"c", false, ActNewTab, ""}, // tmux default survives
	}
	for _, w := range want {
		b, ok := find(km, w.key, w.root)
		if !ok || b.Action != w.action || b.Arg != w.arg {
			t.Errorf("%q root=%v: got %+v ok=%v, want %s %s", w.key, w.root, b, ok, w.action, w.arg)
		}
	}
	for _, gone := range []string{`"`, "%", "C-b"} {
		if b, ok := find(km, gone, false); ok {
			t.Errorf("%q should be unbound, got %+v", gone, b)
		}
	}
	if len(km.Skipped) != 1 || !strings.Contains(km.Skipped[0], "source-file ~/.tmux.conf") {
		t.Errorf("skipped = %q", km.Skipped)
	}
}

func TestNoTmuxConfUsesDefaults(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "")
	km := LoadTmuxKeymap(t.TempDir())
	if km.Source != "" || km.Prefix != "C-b" {
		t.Errorf("got %+v", km)
	}
	if b, ok := find(km, "%", false); !ok || b.Action != ActSplitRight {
		t.Errorf("default %% missing")
	}
}

func TestNormKey(t *testing.T) {
	for in, want := range map[string]string{"C-A": "C-a", "^B": "C-b", "M-C-x": "C-M-x", "pageup": "PPage", "S-left": "S-Left", "f5": "F5", "%": "%"} {
		if got := normKey(in); got != want {
			t.Errorf("normKey(%q) = %q, want %q", in, got, want)
		}
	}
}
