package plane

import (
	"testing"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

func TestRedact(t *testing.T) {
	config.Override(func(c *config.Config) {
		c.Privacy.Locked = []string{"project:TEACH", "module:m-secret"}
		c.Privacy.AutoLockMinutes = 15
	})
	snap := Snapshot{Projects: []Project{
		{ID: "w", Identifier: "WORK", Modules: []Module{{ID: "m-secret"}, {ID: "m-open"}}, Items: []Item{
			{ID: "a", ModuleIDs: []string{"m-secret"}},
			{ID: "b", ModuleIDs: []string{"m-open"}},
			{ID: "c"},
		}},
		{ID: "h", Identifier: "TEACH", Items: []Item{{ID: "x"}}},
	}}
	now := time.Now()
	l := NewLocks()
	l.now = func() time.Time { return now }

	r := l.Redact(snap)
	work, teach := r.Projects[0], r.Projects[1]
	if !teach.Private || !teach.Locked || len(teach.Items) != 0 {
		t.Errorf("teach = %+v", teach)
	}
	if work.Private || work.HiddenItems != 1 || len(work.Items) != 2 || !work.Modules[0].Locked || work.Modules[1].Locked {
		t.Errorf("work = %+v", work)
	}
	if len(snap.Projects[1].Items) != 1 {
		t.Error("Redact modified its input")
	}
	if l.Allowed(snap, "h", "x") || l.Allowed(snap, "w", "a") || !l.Allowed(snap, "w", "b") {
		t.Error("Allowed disagrees with locks")
	}

	l.Unlock("project:TEACH")
	if r := l.Redact(snap); r.Projects[1].Locked || len(r.Projects[1].Items) != 1 {
		t.Errorf("unlocked teach = %+v", r.Projects[1])
	}
	if l.Expired() {
		t.Error("expired too early")
	}
	now = now.Add(16 * time.Minute)
	if !l.Expired() || l.Expired() {
		t.Error("expiry should be reported exactly once")
	}
	if !l.Redact(snap).Projects[1].Locked {
		t.Error("auto-lock didn't relock")
	}
}

func TestPrivacyKeys(t *testing.T) {
	snap := Snapshot{Projects: []Project{
		{ID: "w", Identifier: "work", Items: []Item{{ID: "a", ModuleIDs: []string{"m1", "m2"}}, {ID: "b"}}},
	}}
	cases := map[[2]string][]string{
		{"w", "a"}:    {"project:WORK", "module:m1", "module:m2"},
		{"w", "b"}:    {"project:WORK"},
		{"w", "gone"}: {"project:WORK"},
		{"x", "a"}:    nil,
	}
	for in, want := range cases {
		got := PrivacyKeys(snap, in[0], in[1])
		if len(got) != len(want) {
			t.Errorf("%v: got %v, want %v", in, got, want)
			continue
		}
		for i := range got {
			if got[i] != want[i] {
				t.Errorf("%v: got %v, want %v", in, got, want)
			}
		}
	}
}
