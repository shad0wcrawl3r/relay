package ai

import (
	"strings"
	"testing"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

func TestCustomPrompts(t *testing.T) {
	t.Cleanup(func() { config.Override(func(c *config.Config) { c.AI.Prompts = nil }) })

	// Defaults: every prompt has text, and social prompts fill in the limit.
	for _, d := range Prompts() {
		if strings.TrimSpace(SystemPrompt(d.ID)) == "" {
			t.Errorf("%s has no default", d.ID)
		}
	}
	if s, _ := SocialPrompt("notes", 300); !strings.Contains(s, "under 255 characters") || strings.Contains(s, "{limit}") {
		t.Errorf("default social prompt = %q", s)
	}

	config.Override(func(c *config.Config) {
		c.AI.Prompts = map[string]string{
			PromptPromotion:  "Write like a pirate.",
			PromptSocial:     "Be terse.",
			PromptShipSocial: "Ship it in {limit} chars or fewer.",
		}
	})
	if s, user := LinkedInPrompt(Article{Title: "T", Body: "b"}); s != "Write like a pirate." || !strings.Contains(user, "<article>") {
		t.Errorf("custom promotion prompt = %q (user fence kept: %v)", s, strings.Contains(user, "<article>"))
	}
	// A custom social prompt without the placeholder still gets the limit.
	if s, user := SocialPrompt("notes", 300); !strings.HasPrefix(s, "Be terse.") || !strings.Contains(s, "under 255 characters") || !strings.Contains(user, "<notes>") {
		t.Errorf("custom social prompt = %q", s)
	}
	if s, _ := SocialPromptFor(PromptShipSocial, "notes", 300); s != "Ship it in 255 chars or fewer." {
		t.Errorf("custom ship social prompt = %q", s)
	}
	// Blank means Relay's own.
	config.Override(func(c *config.Config) { c.AI.Prompts = map[string]string{PromptShipArticle: "   "} })
	if SystemPrompt(PromptShipArticle) != shipArticleSystem {
		t.Error("blank custom prompt should fall back to the default")
	}
	if _, ok := PromptByID("nope"); ok || SystemPrompt("nope") != "" {
		t.Error("unknown prompt found")
	}
}
