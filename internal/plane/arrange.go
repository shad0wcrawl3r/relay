package plane

import (
	"slices"
	"strings"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

// Colors are the palette names a project can be given in Settings.
var Colors = []string{"blue", "purple", "teal", "green", "amber", "orange", "rose", "zinc"}

// Arrange orders snap's projects, gives them their colours and picks the quick
// capture project, all from [projects] in config. Projects in the saved order
// come first, in that order; the rest follow by name. It copies the project
// list, so the client's cached snapshot is never reordered.
func Arrange(snap Snapshot) Snapshot {
	c := config.GetConfig().Projects
	rank := map[string]int{}
	for i, id := range c.Order {
		rank[strings.ToUpper(id)] = i
	}
	colors := map[string]string{}
	for id, color := range c.Colors {
		if slices.Contains(Colors, color) {
			colors[strings.ToUpper(id)] = color
		}
	}
	projects := slices.Clone(snap.Projects)
	for i := range projects {
		projects[i].Color = colors[strings.ToUpper(projects[i].Identifier)]
	}
	slices.SortStableFunc(projects, func(a, b Project) int {
		ra, okA := rank[strings.ToUpper(a.Identifier)]
		rb, okB := rank[strings.ToUpper(b.Identifier)]
		switch {
		case okA && okB:
			return ra - rb
		case okA:
			return -1
		case okB:
			return 1
		}
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	snap.Projects = projects
	snap.CaptureProject = ""
	for _, p := range projects {
		if strings.EqualFold(p.Identifier, c.Capture) {
			snap.CaptureProject = p.ID
		}
	}
	return snap
}
