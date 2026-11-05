package main

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/vault"
	"github.com/zalando/go-keyring"
)

func TestIdeaToItemNamesAndEscapes(t *testing.T) {
	name, desc := ideaToItem("", "First line <b>\nsecond\n\nNext para & more")
	if name != "First line <b>" {
		t.Errorf("name = %q", name)
	}
	if !strings.Contains(desc, "<p>First line &lt;b&gt;<br>second</p><p>Next para &amp; more</p>") || !strings.Contains(desc, "From a Buffer idea") {
		t.Errorf("desc = %q", desc)
	}
	if name, _ := ideaToItem("  Title ", "body"); name != "Title" {
		t.Errorf("titled name = %q", name)
	}
	if name, _ := ideaToItem("", ""); name != "Buffer idea" {
		t.Errorf("empty name = %q", name)
	}
	if name, _ := ideaToItem(strings.Repeat("é", 300), ""); len([]rune(name)) != maxItemName {
		t.Errorf("long name has %d runes", len([]rune(name)))
	}
}

func TestHTMLToText(t *testing.T) {
	got := htmlToText(`<p>Hello <strong>there</strong></p><ul><li>one</li><li>two &amp; three</li></ul><p></p><p>end<br/>line</p>`)
	want := "Hello there\n\none\n\ntwo & three\n\nend\n\nline"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestIdeaLinksPersistEncrypted(t *testing.T) {
	keyring.MockInit()
	vault.Reset()
	path := filepath.Join(t.TempDir(), "links.json")
	l := newIdeaLinks(path)
	if err := l.add(IdeaLink{IdeaID: "i1", ProjectID: "p1", ItemID: "it1", Key: "RELAY-9", At: time.Now()}); err != nil {
		t.Fatal(err)
	}
	again := newIdeaLinks(path)
	if link, ok := again.forIdea("i1"); !ok || link.Key != "RELAY-9" {
		t.Errorf("forIdea = %+v, %v", link, ok)
	}
	if link, ok := again.forItem("it1"); !ok || link.IdeaID != "i1" {
		t.Errorf("forItem = %+v, %v", link, ok)
	}
	if _, ok := again.forItem("other"); ok {
		t.Error("unrelated item linked")
	}
	if _, err := vault.ReadFile(path); err != nil {
		t.Errorf("not readable through the vault: %v", err)
	}
}
