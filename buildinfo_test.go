package main

import "testing"

func TestDisplayVersion(t *testing.T) {
	cases := []struct {
		b    BuildInfo
		want string
	}{
		{BuildInfo{Version: "0.0.5"}, "0.0.5"},
		{BuildInfo{Version: "0.0.5", Commit: "abc1234567"}, "0.0.5"},
		{BuildInfo{Version: "0.0.5", Dev: true, Commit: "abc1234567"}, "abc1234567"},
		{BuildInfo{Version: "0.0.5", Dev: true, Commit: "abc1234567", Dirty: true}, "abc1234567-dirty"},
		{BuildInfo{Version: "0.0.5", Dev: true}, "dev"},
	}
	for _, c := range cases {
		if got := displayVersion(c.b); got != c.want {
			t.Errorf("%+v: got %q, want %q", c.b, got, c.want)
		}
	}
}

func TestBuildInfoInCheckout(t *testing.T) {
	b := buildInfo()
	if b.Version == "" || b.Go == "" || b.Wails == "" {
		t.Errorf("missing fields: %+v", b)
	}
	// Tests run in the repo, as a dev build: the commit comes from git.
	if b.Dev && b.Commit == "" {
		t.Skip("not a git checkout")
	}
	if b.Dev && b.Display[:len(b.Commit)] != b.Commit {
		t.Errorf("dev display %q should start with the commit %q", b.Display, b.Commit)
	}
}
