package main

import "strings"

// AI-use disclosure for Dev.to. Its API has no field for it; DEV's
// guidelines for AI-assisted articles ask for a statement in the article
// itself ("at any point in the article's copy, including right at the end").
// The post keeps the user's choice (posts.Meta.AI) and Go adds the matching
// line when sending, so the local body stays as the user wrote it.

const (
	AINone      = "none"
	AIAssisted  = "assisted"
	AIGenerated = "generated"
)

// disclosures are the lines added at the end of the article, by level.
var disclosures = map[string]string{
	AIAssisted:  "*This post was written with the help of AI.*",
	AIGenerated: "*This post was generated with AI.*",
}

// Disclosures returns the line each level adds, for the editor's preview.
func (s *PostService) Disclosures() map[string]string {
	return disclosures
}

// withDisclosure is the body as Dev.to gets it: any disclosure Relay added
// before is replaced by the one for level. An empty level is "none", so
// posts from before the setting existed send unchanged.
func withDisclosure(body, level string) string {
	body, _ = splitDisclosure(body)
	line, ok := disclosures[level]
	if !ok {
		return body
	}
	if strings.TrimSpace(body) == "" {
		return line
	}
	return strings.TrimRight(body, " \t\r\n") + "\n\n" + line + "\n"
}

// splitDisclosure takes a disclosure line Relay added off the end of a body
// from Dev.to, and says which level it was ("" when there was none).
func splitDisclosure(body string) (string, string) {
	trimmed := strings.TrimRight(body, " \t\r\n")
	for level, line := range disclosures {
		if strings.HasSuffix(trimmed, line) {
			rest := strings.TrimRight(strings.TrimSuffix(trimmed, line), " \t\r\n")
			if rest != "" {
				rest += "\n"
			}
			return rest, level
		}
	}
	return body, ""
}
