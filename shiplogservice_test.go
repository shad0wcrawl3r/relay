package main

import (
	"context"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/plane"
)

func TestFinishedItems(t *testing.T) {
	config.Override(func(c *config.Config) { c.Privacy.Locked = []string{"project:SECRET", "module:m-private"} })
	t.Cleanup(func() { config.Override(func(c *config.Config) { c.Privacy.Locked = nil }) })

	states := []plane.State{{ID: "done", Group: "completed"}, {ID: "todo", Group: "unstarted"}}
	snap := plane.Snapshot{Projects: []plane.Project{
		{ID: "p1", Name: "Relay", Identifier: "RELAY", States: states, Items: []plane.Item{
			{ID: "a", Key: "RELAY-1", Name: "Cache Buffer", StateID: "done", CompletedAt: "2026-11-08T10:00:00Z"},
			{ID: "b", Key: "RELAY-2", Name: "Too old", StateID: "done", CompletedAt: "2026-10-01T10:00:00Z"},
			{ID: "c", Key: "RELAY-3", Name: "Not done", StateID: "todo", UpdatedAt: "2026-11-08T10:00:00Z"},
			{ID: "d", Key: "RELAY-4", Name: "Private module", StateID: "done", CompletedAt: "2026-11-08T10:00:00Z", ModuleIDs: []string{"m-private"}},
			{ID: "e", Key: "RELAY-5", Name: "No completed date", StateID: "done", UpdatedAt: "2026-11-07T10:00:00Z"},
		}},
		{ID: "p2", Name: "Hidden", Identifier: "SECRET", States: states, Items: []plane.Item{
			{ID: "x", Key: "SECRET-1", Name: "Never shown", StateID: "done", CompletedAt: "2026-11-08T10:00:00Z"},
		}},
	}}
	q := ShipLogQuery{Since: time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), Until: time.Date(2026, 11, 9, 0, 0, 0, 0, time.UTC)}
	items, skipped := finishedItems(snap, q)
	var keys []string
	for _, it := range items {
		keys = append(keys, it.Key)
	}
	if strings.Join(keys, ",") != "RELAY-5,RELAY-1" || skipped != 1 {
		t.Errorf("items = %v, skipped = %d", keys, skipped)
	}
}

func TestSplitTitle(t *testing.T) {
	title, body := splitTitle("```markdown\n# Shipped: a cache\n\nBody text.\n```")
	if title != "Shipped: a cache" || body != "Body text.\n" {
		t.Errorf("got %q / %q", title, body)
	}
	if title, body := splitTitle("No heading here."); title != "" || body != "No heading here.\n" {
		t.Errorf("got %q / %q", title, body)
	}
}

func TestGitCommits(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("no git")
	}
	dir := t.TempDir()
	run := func(env []string, args ...string) {
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(cmd.Environ(), env...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run(nil, "init", "-q")
	when := func(d string) []string {
		return []string{"GIT_AUTHOR_DATE=" + d, "GIT_COMMITTER_DATE=" + d, "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t"}
	}
	run(when("2026-10-01T10:00:00Z"), "commit", "-q", "--allow-empty", "-m", "Old work")
	run(when("2026-11-05T10:00:00Z"), "commit", "-q", "--allow-empty", "-m", "Add the cache\n\nBody never read.")
	run(when("2026-11-06T10:00:00Z"), "commit", "-q", "--allow-empty", "-m", "Fix the preview")

	got, err := gitCommits(context.Background(), dir, time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 11, 9, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Subject != "Add the cache" || got[1].Subject != "Fix the preview" || got[0].Date != "2026-11-05" {
		t.Errorf("commits = %+v", got)
	}
	if _, err := gitCommits(context.Background(), t.TempDir(), time.Now().Add(-time.Hour), time.Now()); err == nil || !strings.Contains(err.Error(), "git repository") {
		t.Errorf("non-repo err = %v", err)
	}
}
