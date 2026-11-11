package plane

import (
	"context"
	"errors"
	"net/http"
	"regexp"
)

// Checklists in item descriptions. Plane's editor stores a checklist as
//
//	<ul data-type="taskList"><li data-checked="false" data-type="taskItem">…</li></ul>
//
// Relay ticks an item by re-reading the description from Plane and flipping
// only that item's data-checked attribute, so nothing else in the
// description (mentions, formatting Relay doesn't render) can be lost, and
// an edit made in Plane meanwhile isn't overwritten.

var (
	taskItemTag = regexp.MustCompile(`<li\b[^>]*\bdata-type="taskItem"[^>]*>`)
	checkedAttr = regexp.MustCompile(`\bdata-checked="(?:true|false)"`)
)

// ErrNoTask is a checklist index the description doesn't have.
var ErrNoTask = errors.New("that checklist item isn't in the description any more; reload the item")

// SetTask returns html with the index-th checklist item (0-based, in
// document order) ticked or not.
func SetTask(html string, index int, checked bool) (string, error) {
	locs := taskItemTag.FindAllStringIndex(html, -1)
	if index < 0 || index >= len(locs) {
		return "", ErrNoTask
	}
	start, end := locs[index][0], locs[index][1]
	tag := html[start:end]
	val := `data-checked="false"`
	if checked {
		val = `data-checked="true"`
	}
	if checkedAttr.MatchString(tag) {
		tag = checkedAttr.ReplaceAllString(tag, val)
	} else {
		tag = tag[:len(tag)-1] + " " + val + ">"
	}
	return html[:start] + tag + html[end:], nil
}

// SetTask ticks or unticks one checklist item in an item's description.
func (c *Client) SetTask(ctx context.Context, pid, id string, index int, checked bool) error {
	if c.stale() {
		return ErrStale
	}
	var ri rawItem
	if err := c.api.do(ctx, http.MethodGet, "/projects/"+pid+"/work-items/"+id+"/", nil, &ri); err != nil {
		return err
	}
	next, err := SetTask(ri.DescriptionHTML, index, checked)
	if err != nil {
		return err
	}
	return c.api.do(ctx, http.MethodPatch, "/projects/"+pid+"/work-items/"+id+"/", map[string]any{"description_html": next}, nil)
}
