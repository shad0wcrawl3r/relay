package ai

import (
	"strings"
	"testing"
)

func TestSocialPromptFitsTheLimit(t *testing.T) {
	system, user := SocialPrompt("  shipped the cache  ", 280)
	if !strings.Contains(system, "under 238 characters") {
		t.Errorf("system prompt doesn't carry the limit: %q", system)
	}
	if !strings.Contains(user, "<notes>\nshipped the cache\n</notes>") {
		t.Errorf("user prompt = %q", user)
	}
	if system, _ = SocialPrompt("x", 0); !strings.Contains(system, "under 2550 characters") {
		t.Errorf("no limit should fall back to LinkedIn's: %q", system)
	}
}
