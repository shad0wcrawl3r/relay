package main

import (
	"context"
	"strings"
	"testing"
)

func TestComposedTextIsWhatComposeSends(t *testing.T) {
	b := &BufferService{}
	if got := b.ComposedText("  hello \n"); got != "hello\n\n"+EvalNoteText {
		t.Errorf("got %q", got)
	}
	// Composed posts carry no article link.
	if got := b.ComposedText("hi"); strings.Contains(got, "dev.to") {
		t.Errorf("got %q", got)
	}
}

func TestComposeNeedsTextAndAChannel(t *testing.T) {
	b := &BufferService{}
	if _, err := b.Compose(context.Background(), Composed{ChannelIDs: []string{"c"}, Text: "  "}); err == nil {
		t.Error("sent an empty post")
	}
	if _, err := b.Compose(context.Background(), Composed{Text: "hi"}); err == nil {
		t.Error("sent a post to no channel")
	}
}
