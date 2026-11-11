package plane

import (
	"strings"
	"testing"
)

func TestSetTask(t *testing.T) {
	in := `<p>x</p><ul data-type="taskList"><li data-checked="false" data-type="taskItem"><p>a</p></li>` +
		`<li data-type="taskItem" data-checked="true"><p>b</p></li><li data-type="taskItem"><p>c</p></li></ul><p>@[mention]</p>`
	out, err := SetTask(in, 0, true)
	if err != nil || out != `<p>x</p><ul data-type="taskList"><li data-checked="true" data-type="taskItem"><p>a</p></li>`+
		`<li data-type="taskItem" data-checked="true"><p>b</p></li><li data-type="taskItem"><p>c</p></li></ul><p>@[mention]</p>` {
		t.Fatalf("tick first: %q %v", out, err)
	}
	if out, _ = SetTask(in, 1, false); out == in || !strings.Contains(out, `<li data-type="taskItem" data-checked="false"><p>b</p>`) {
		t.Fatalf("untick second: %q", out)
	}
	if out, _ = SetTask(in, 2, true); !strings.Contains(out, `<li data-type="taskItem" data-checked="true"><p>c</p>`) {
		t.Fatalf("tick item without the attribute: %q", out)
	}
	if _, err := SetTask(in, 3, true); err != ErrNoTask {
		t.Fatalf("out of range: %v", err)
	}
	// A plain list item isn't a checklist item.
	if _, err := SetTask(`<ul><li>plain</li></ul>`, 0, true); err != ErrNoTask {
		t.Fatalf("plain list: %v", err)
	}
}
