package main

import "testing"

func TestWithDisclosure(t *testing.T) {
	body := "Hello.\n\nMore text.\n"
	got := withDisclosure(body, AIAssisted)
	want := "Hello.\n\nMore text.\n\n" + disclosures[AIAssisted] + "\n"
	if got != want {
		t.Fatalf("assisted:\n%q\nwant\n%q", got, want)
	}
	// Sending again, or switching level, never stacks lines.
	if again := withDisclosure(got, AIAssisted); again != want {
		t.Errorf("resend stacked: %q", again)
	}
	if switched := withDisclosure(got, AIGenerated); switched != "Hello.\n\nMore text.\n\n"+disclosures[AIGenerated]+"\n" {
		t.Errorf("switch: %q", switched)
	}
	for _, level := range []string{"", AINone} {
		if none := withDisclosure(got, level); none != "Hello.\n\nMore text.\n" {
			t.Errorf("level %q: %q", level, none)
		}
	}
	if untouched := withDisclosure(body, ""); untouched != body {
		t.Errorf("old posts must send unchanged: %q", untouched)
	}
}

func TestSplitDisclosure(t *testing.T) {
	body, level := splitDisclosure("Text\n\n" + disclosures[AIGenerated] + "\n\n")
	if body != "Text\n" || level != AIGenerated {
		t.Errorf("got %q, %q", body, level)
	}
	if body, level := splitDisclosure("Just text"); body != "Just text" || level != "" {
		t.Errorf("got %q, %q", body, level)
	}
}
