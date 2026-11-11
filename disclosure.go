package main

import "strings"

// AI-use disclosure for Dev.to. The post keeps the user's choice
// (posts.Meta.AI) and Go sends it as Forem's ai_disclosure_level, the "AI:"
// marker in Dev.to's editor, so the body stays as the user wrote it.
//
// Before Forem had the field, Relay added a line at the end of the article
// instead. Those lines are still taken off bodies from Dev.to (and read as
// the level when the article has none), and a re-send removes them.

const (
	AINone      = "none"
	AIAssisted  = "assisted"
	AIGenerated = "generated"
)

// devtoLevels maps Relay's levels to Forem's. Empty is "none", as the
// editor shows it.
var devtoLevels = map[string]string{
	"":          "no_ai",
	AINone:      "no_ai",
	AIAssisted:  "some_ai",
	AIGenerated: "fully_autonomous",
}

// devtoLevel is the ai_disclosure_level Relay sends for level.
func devtoLevel(level string) string {
	if v, ok := devtoLevels[level]; ok {
		return v
	}
	return "no_ai"
}

// relayLevel is Relay's level for one from Dev.to, or "" when the article
// doesn't say (not_disclosed, or a Forem without the field).
func relayLevel(devto string) string {
	switch devto {
	case "no_ai":
		return AINone
	case "some_ai":
		return AIAssisted
	case "fully_autonomous":
		return AIGenerated
	}
	return ""
}

// legacyDisclosures are the lines Relay used to add at the end of the article.
var legacyDisclosures = map[string]string{
	AIAssisted:  "*This post was written with the help of AI.*",
	AIGenerated: "*This post was generated with AI.*",
}

// splitDisclosure takes a line Relay added before off the end of a body
// from Dev.to, and says which level it was ("" when there was none).
func splitDisclosure(body string) (string, string) {
	trimmed := strings.TrimRight(body, " \t\r\n")
	for level, line := range legacyDisclosures {
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

// remoteBody is a Dev.to article's body and AI level as Relay keeps them.
// level is "" when Dev.to doesn't say.
func remoteBody(body, devtoLevel string) (string, string) {
	body, line := splitDisclosure(body)
	if level := relayLevel(devtoLevel); level != "" {
		return body, level
	}
	return body, line
}
