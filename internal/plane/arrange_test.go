package plane

import (
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

func TestArrange(t *testing.T) {
	prev := config.GetConfig().Projects
	t.Cleanup(func() { config.Override(func(c *config.Config) { c.Projects = prev }) })
	config.Override(func(c *config.Config) {
		c.Projects.Order = []string{"ops", "WEB"}
		// Keys come back lowercased from TOML; "pink" isn't a palette colour.
		c.Projects.Colors = map[string]string{"web": "teal", "zed": "pink"}
		c.Projects.Capture = "zed"
	})
	in := Snapshot{Projects: []Project{
		{ID: "z", Identifier: "ZED", Name: "zed"},
		{ID: "a", Identifier: "ALPHA", Name: "Alpha"},
		{ID: "w", Identifier: "WEB", Name: "Web"},
		{ID: "o", Identifier: "OPS", Name: "Ops"},
	}}
	got := Arrange(in)

	var order []string
	for _, p := range got.Projects {
		order = append(order, p.Identifier)
	}
	if want := "OPS WEB ALPHA ZED"; join(order) != want {
		t.Errorf("order = %s, want %s", join(order), want)
	}
	if got.Projects[1].Color != "teal" || got.Projects[3].Color != "" {
		t.Errorf("colours = %q, %q", got.Projects[1].Color, got.Projects[3].Color)
	}
	if got.CaptureProject != "z" {
		t.Errorf("capture = %q, want z", got.CaptureProject)
	}
	if in.Projects[0].Identifier != "ZED" {
		t.Error("Arrange reordered the caller's slice")
	}
}

func join(s []string) string {
	out := ""
	for i, v := range s {
		if i > 0 {
			out += " "
		}
		out += v
	}
	return out
}
