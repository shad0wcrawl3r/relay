package main

import "testing"

func TestDevtoLevels(t *testing.T) {
	for relay, devto := range map[string]string{"": "no_ai", AINone: "no_ai", AIAssisted: "some_ai", AIGenerated: "fully_autonomous", "bogus": "no_ai"} {
		if got := devtoLevel(relay); got != devto {
			t.Errorf("devtoLevel(%q) = %q, want %q", relay, got, devto)
		}
	}
	for devto, relay := range map[string]string{"no_ai": AINone, "some_ai": AIAssisted, "fully_autonomous": AIGenerated, "not_disclosed": "", "": ""} {
		if got := relayLevel(devto); got != relay {
			t.Errorf("relayLevel(%q) = %q, want %q", devto, got, relay)
		}
	}
}

func TestLegacyDisclosureLine(t *testing.T) {
	old := "Text\n\n" + legacyDisclosures[AIGenerated] + "\n\n"
	if body, level := splitDisclosure(old); body != "Text\n" || level != AIGenerated {
		t.Fatalf("split = %q, %q", body, level)
	}
	if body, level := splitDisclosure("Just text"); body != "Just text" || level != "" {
		t.Fatalf("plain = %q, %q", body, level)
	}
	// Dev.to's marker wins over an old line; the line still comes off.
	if body, level := remoteBody(old, "some_ai"); body != "Text\n" || level != AIAssisted {
		t.Fatalf("marker and line = %q, %q", body, level)
	}
	// No marker: the old line says the level.
	if _, level := remoteBody(old, "not_disclosed"); level != AIGenerated {
		t.Fatalf("line only = %q", level)
	}
}
