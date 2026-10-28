package devto

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestFlexTags(t *testing.T) {
	for _, in := range []string{`["go","wails"]`, `"go, wails"`} {
		var f flexTags
		if err := json.Unmarshal([]byte(in), &f); err != nil {
			t.Fatal(err)
		}
		if strings.Join(f, ",") != "go,wails" {
			t.Errorf("%s -> %v", in, f)
		}
	}
}

func TestUpdateNeverSendsPublished(t *testing.T) {
	// Re-sending must not unpublish an article that went live on Dev.to.
	p := Payload{Title: "t"}
	p.Published = nil
	b, _ := json.Marshal(p)
	if strings.Contains(string(b), "published") {
		t.Errorf("update payload contains published: %s", b)
	}
	f := false
	p.Published = &f
	b, _ = json.Marshal(p)
	if !strings.Contains(string(b), `"published":false`) {
		t.Errorf("create payload missing published:false: %s", b)
	}
}
