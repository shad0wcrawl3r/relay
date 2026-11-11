package main

import (
	_ "embed"
	"os"
	"regexp"
	"strings"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

// The changelog is CHANGELOG.md, built into the app. After an update Relay
// shows the entries since the version the user last saw (What's new), once;
// Settings → About lists them all. It's plain text: no links or markup are
// rendered, so the file can't put anything active in the UI.

//go:embed CHANGELOG.md
var changelogFile string

// ChangelogEntry is one release's changes.
type ChangelogEntry struct {
	// Version is X.Y.Z, or "Unreleased" (dev builds only).
	Version string   `json:"version"`
	Date    string   `json:"date"`
	Changes []string `json:"changes"`
}

// WhatsNew is what to show after an update: the entries newer than the
// version last seen, up to this one. Empty when there's nothing new.
type WhatsNew struct {
	Version string           `json:"version"`
	Entries []ChangelogEntry `json:"entries"`
}

var changelogHeading = regexp.MustCompile(`^##\s+(\S+)(?:\s+[—–-]\s+(\S+))?\s*$`)

// parseChangelog reads `## X.Y.Z — date` headings and the `- ` lines under
// them, newest first as written. Anything else is ignored.
func parseChangelog(text string) []ChangelogEntry {
	var out []ChangelogEntry
	var cur *ChangelogEntry
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimRight(line, " \t\r")
		if m := changelogHeading.FindStringSubmatch(line); m != nil {
			out = append(out, ChangelogEntry{Version: m[1], Date: m[2], Changes: []string{}})
			cur = &out[len(out)-1]
			continue
		}
		if strings.HasPrefix(line, "# ") {
			cur = nil
			continue
		}
		if cur == nil {
			continue
		}
		switch {
		case strings.HasPrefix(line, "- "):
			cur.Changes = append(cur.Changes, strings.TrimSpace(line[2:]))
		case strings.HasPrefix(line, "  ") && len(cur.Changes) > 0 && strings.TrimSpace(line) != "":
			// A wrapped bullet.
			cur.Changes[len(cur.Changes)-1] += " " + strings.TrimSpace(line)
		}
	}
	return out
}

// changelog is the built-in changelog. Release builds leave out Unreleased.
func changelog(dev bool) []ChangelogEntry {
	all := parseChangelog(changelogFile)
	out := all[:0:0]
	for _, e := range all {
		if _, _, ok := parseVersion(e.Version); ok || (dev && strings.EqualFold(e.Version, "Unreleased")) {
			out = append(out, e)
		}
	}
	return out
}

// whatsNew picks the released entries after seen, up to current. With no
// seen version it's just current's entry.
func whatsNew(entries []ChangelogEntry, seen, current string) []ChangelogEntry {
	out := []ChangelogEntry{}
	for _, e := range entries {
		if _, _, ok := parseVersion(e.Version); !ok || newer(e.Version, current) {
			continue
		}
		if seen == "" {
			if e.Version == current {
				out = append(out, e)
			}
			continue
		}
		if newer(e.Version, seen) {
			out = append(out, e)
		}
	}
	return out
}

// configExisted: config.toml was there before this launch, so Relay has run
// here before. Read before anything can write it.
var configExisted = func() bool {
	_, err := os.Stat(config.Path())
	return err == nil
}()

// Changelog lists every release's changes, newest first, for About.
func (s *UpdateService) Changelog() []ChangelogEntry { return changelog(!releaseBuild) }

// WhatsNew is the changelog to show once after an update. A fresh install
// has nothing to show: it records this version and returns none. Dev
// builds show it only with RELAY_WHATS_NEW set, as the newest entry.
func (s *UpdateService) WhatsNew() (WhatsNew, error) {
	current := appVersion()
	none := WhatsNew{Version: current, Entries: []ChangelogEntry{}}
	if !releaseBuild {
		if all := changelog(true); os.Getenv("RELAY_WHATS_NEW") != "" && len(all) > 0 {
			return WhatsNew{Version: buildInfo().Display, Entries: all[:1]}, nil
		}
		return none, nil
	}
	seen := config.GetConfig().Updates.Seen
	if seen == current || (seen != "" && !newer(current, seen)) {
		return none, nil
	}
	if seen == "" && !configExisted {
		return none, s.MarkSeen()
	}
	return WhatsNew{Version: current, Entries: whatsNew(changelog(false), seen, current)}, nil
}

// MarkSeen records that this version's changes were shown. Dev builds
// don't record anything.
func (s *UpdateService) MarkSeen() error {
	if !releaseBuild {
		return nil
	}
	current := appVersion()
	if config.GetConfig().Updates.Seen == current {
		return nil
	}
	return config.Update(func(c *config.Config) { c.Updates.Seen = current })
}
