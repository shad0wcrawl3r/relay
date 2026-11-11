package posts

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveGetRoundTrip(t *testing.T) {
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	body := "Intro\n\n---\n\n## Heading\n\n<INSERT IMAGE HERE: diagram>\n"
	saved, err := s.Save(Post{Body: body, Meta: Meta{Title: "Hello: world", Tags: []string{"go", "wails"}, DevtoID: 42}})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Body != body {
		t.Errorf("body = %q, want %q", got.Body, body)
	}
	if got.Title != "Hello: world" || got.DevtoID != 42 || strings.Join(got.Tags, ",") != "go,wails" {
		t.Errorf("meta = %+v", got.Meta)
	}
}

func TestGetWithoutFrontMatter(t *testing.T) {
	dir := t.TempDir()
	s, _ := NewStore(dir)
	if err := os.WriteFile(filepath.Join(dir, "plain.md"), []byte("# Just markdown\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	p, err := s.Get("plain")
	if err != nil {
		t.Fatal(err)
	}
	if p.Body != "# Just markdown\n" {
		t.Errorf("body = %q", p.Body)
	}
}

func TestRejectsPathTraversal(t *testing.T) {
	s, _ := NewStore(t.TempDir())
	for _, id := range []string{"../x", "a/b", "x.md", ""} {
		if _, err := s.Get(id); err == nil {
			t.Errorf("Get(%q) succeeded", id)
		}
	}
}

func TestPlaneItemsRoundTrip(t *testing.T) {
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.Save(Post{Meta: Meta{Title: "Linked", PlaneItems: []PlaneLink{{ProjectID: "p1", ItemID: "i1"}}}, Body: "x\n"})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(p.ID)
	if err != nil || len(got.PlaneItems) != 1 || got.PlaneItems[0] != (PlaneLink{ProjectID: "p1", ItemID: "i1"}) {
		t.Fatalf("got %+v, %v", got.PlaneItems, err)
	}
}
