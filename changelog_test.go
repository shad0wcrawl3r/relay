package main

import "testing"

func TestParseChangelog(t *testing.T) {
	got := parseChangelog("# Changelog\n\n- not a change\n\n## Unreleased\n\n- next\n\n## 0.0.2 — 2026-11-05\n\n- one\n- two that\n  wraps\n\n## 0.0.1\n- first\n")
	if len(got) != 3 {
		t.Fatalf("got %d entries: %+v", len(got), got)
	}
	if got[1].Version != "0.0.2" || got[1].Date != "2026-11-05" || len(got[1].Changes) != 2 || got[1].Changes[1] != "two that wraps" {
		t.Errorf("0.0.2: %+v", got[1])
	}
	if got[2].Date != "" || got[2].Changes[0] != "first" {
		t.Errorf("0.0.1: %+v", got[2])
	}
}

func TestWhatsNewPicksVersionsSinceSeen(t *testing.T) {
	entries := []ChangelogEntry{{Version: "Unreleased"}, {Version: "0.0.9"}, {Version: "0.0.8"}, {Version: "0.0.7"}, {Version: "0.0.6"}}
	versions := func(es []ChangelogEntry) (out []string) {
		for _, e := range es {
			out = append(out, e.Version)
		}
		return out
	}
	for _, c := range []struct {
		seen, current string
		want          []string
	}{
		{"0.0.6", "0.0.8", []string{"0.0.8", "0.0.7"}},
		{"", "0.0.8", []string{"0.0.8"}},
		{"0.0.8", "0.0.8", nil},
	} {
		got := versions(whatsNew(entries, c.seen, c.current))
		if len(got) != len(c.want) {
			t.Errorf("seen %s, current %s: got %v, want %v", c.seen, c.current, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("seen %s, current %s: got %v, want %v", c.seen, c.current, got, c.want)
			}
		}
	}
}

// The release PR has to rename Unreleased to the new version, or the update
// would open with nothing to show.
func TestChangelogHasThisVersion(t *testing.T) {
	v := appVersion()
	for _, e := range changelog(false) {
		if e.Version == v {
			if len(e.Changes) == 0 {
				t.Fatalf("CHANGELOG.md's %s entry lists no changes", v)
			}
			return
		}
	}
	t.Fatalf("CHANGELOG.md has no ## %s entry; rename Unreleased in the release PR", v)
}
