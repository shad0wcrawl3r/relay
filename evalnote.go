package main

import (
	"strings"
	"testing"
)

// EvalNoteText ends every Buffer post sent from a dev build or a test run, so
// a test post left in the queue still goes out labelled, and says where it
// came from: the link is Relay's status page.
const EvalNoteText = "Created via Relay for test/evaluation: https://relay.shadowcrawler.dev"

func evalMarking() bool { return !releaseBuild || testing.Testing() }

// withEvalNote adds the note, once, outside release builds.
func withEvalNote(text string) string {
	if !evalMarking() || strings.Contains(text, EvalNoteText) {
		return text
	}
	return strings.TrimSpace(text) + "\n\n" + EvalNoteText
}

// promotionText is exactly what goes to Buffer for an article: the text, the
// article's link, and the note in dev builds.
func promotionText(text, url string) string {
	return withEvalNote(withLink(text, url))
}

// EvalNote is the note dev builds add to posts, or "" in release builds, so
// the composer can count it.
func (s *BufferService) EvalNote() string {
	if !evalMarking() {
		return ""
	}
	return EvalNoteText
}
