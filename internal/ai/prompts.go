package ai

import (
	"strconv"
	"strings"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

// Every system prompt Relay sends can be rewritten in Settings → AI. A
// custom prompt is kept in config.toml (`[ai] PROMPTS`, by ID); an empty or
// default one is removed, so Relay's own improvements reach it again.
//
// Only the instructions are editable. What keeps data in its place isn't:
// the user message still fences articles and notes off as content, the
// privacy gate still decides where they may go, and Go still adds the
// article link to promotions. Parts Relay parses (Ship's reply format) are
// added after the custom text, and shown read-only.

const (
	PromptPromotion   = "promotion"
	PromptSocial      = "social"
	PromptShipArticle = "ship-article"
	PromptShipSocial  = "ship-social"
)

// MaxPromptChars bounds a custom prompt.
const MaxPromptChars = 8000

// limitPlaceholder is replaced with the character target in social prompts.
const limitPlaceholder = "{limit}"

// PromptDef describes one editable prompt.
type PromptDef struct {
	ID string
	// Name and Use are shown in Settings.
	Name string
	Use  string
	// Default is Relay's own text.
	Default string
	// Fixed is added after the prompt, whatever it says, because Relay
	// parses the reply. Empty for most prompts.
	Fixed string
	// Placeholders are filled in when the prompt is sent.
	Placeholders []string
}

var promptDefs = []PromptDef{
	{
		ID:      PromptPromotion,
		Name:    "Promote an article",
		Use:     "Promote → Draft with AI, and summarising pasted text in the Buffer composer.",
		Default: linkedInSystem,
	},
	{
		ID:           PromptSocial,
		Name:         "Post from notes",
		Use:          "Draft with AI in the Buffer composer, from your notes.",
		Default:      socialSystem,
		Placeholders: []string{limitPlaceholder},
	},
	{
		ID:      PromptShipArticle,
		Name:    "Ship: article",
		Use:     "Ship → Draft article, from finished items, commits and notes.",
		Default: shipArticleSystem,
		Fixed:   ShipArticleFormat,
	},
	{
		ID:           PromptShipSocial,
		Name:         "Ship: Buffer post",
		Use:          "Ship → Buffer post.",
		Default:      shipSocialSystem,
		Placeholders: []string{limitPlaceholder},
	},
}

// Prompts lists the editable prompts.
func Prompts() []PromptDef { return append([]PromptDef(nil), promptDefs...) }

// PromptByID returns the prompt with id.
func PromptByID(id string) (PromptDef, bool) {
	for _, d := range promptDefs {
		if d.ID == id {
			return d, true
		}
	}
	return PromptDef{}, false
}

// SystemPrompt is the prompt to send for id: the user's, or Relay's own.
// Fixed text isn't included; callers that need it add it.
func SystemPrompt(id string) string {
	d, ok := PromptByID(id)
	if !ok {
		return ""
	}
	if custom := strings.TrimSpace(config.GetConfig().AI.Prompts[id]); custom != "" {
		return custom
	}
	return d.Default
}

// withLimit fills in the character target, adding a line for it when a
// custom prompt left the placeholder out.
func withLimit(system string, target int) string {
	if !strings.Contains(system, limitPlaceholder) {
		system += "\nStay under " + limitPlaceholder + " characters, hashtags included."
	}
	return strings.ReplaceAll(system, limitPlaceholder, strconv.Itoa(target))
}

const shipArticleSystem = `You write a blog post for Dev.to about work a developer finished, in their own voice: "I", never "we".

Everything in the post comes from the material you are given: the finished work items, the commits and the author's notes. The title, the tags and every section name what was actually built, fixed or changed.

The title says what the work is, specifically, for example "Offline sync and faster search in Relay". It is not a label for the post: no "build in public", "ship log", "devlog", "weekly update", "progress update", "what I shipped" and no dates.
Don't describe the post itself or the habit of sharing progress: never mention building in public, devlogs, challenges or communities, unless the author's notes do.

Use only the material. Never invent features, numbers, results, motivations, quotes or feelings. If the material is thin, write a short post rather than padding it.
Group the work by theme instead of listing commits one by one, and say why a change matters only when the material says so.
Short paragraphs, plain words, no hype ("excited", "thrilled", "game-changer").`

// ShipArticleFormat is the reply format Ship parses (title, then tags). It
// follows the Ship article prompt, custom or not.
const ShipArticleFormat = `Reply in Markdown, in this order:
1. The title, on one line starting with "# ".
2. One line starting with "Tags: ", then up to four Dev.to tags for the technologies and topics the work is about, lowercase letters and numbers only, comma-separated (for example "Tags: go, sqlite, oauth"). No generic tags such as buildinpublic, devlog, programming or update.
3. The body: an opening that says what changed, ## sections for the themes, and a brief "What's next" only if the notes mention plans.`

const shipSocialSystem = socialSystem + `
Any hashtags name the technologies or topics of the work, never generic ones such as #buildinpublic, #devlog or #100daysofcode, and the post doesn't talk about building in public, unless the notes do.`
