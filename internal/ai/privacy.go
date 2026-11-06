package ai

import (
	"errors"
	"fmt"
	"slices"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

// Private projects and modules (config privacy.LOCKED) may only reach a
// private provider: one the user marked as a model they run or control.
// Ollama and LM Studio start marked, at their default local endpoints only.
// A local-looking address alone isn't enough: localhost can be a proxy to
// the cloud, and an "Ollama" endpoint can be Ollama Cloud. The
// check is here, at the one function that sends prompts, so no caller and no
// UI can skip it. Unlocking a project in Relay doesn't change this: unlocking
// is about who sits at the screen, not where the data may go.

// ErrPrivate means the prompt holds private data and the provider isn't
// trusted with it. It never names the project.
type ErrPrivate struct{ Provider string }

func (e ErrPrivate) Error() string {
	return fmt.Sprintf("this includes work from a private project, and %s isn't a private provider. Pick one that is, or mark %s as one in Settings → AI if you run or control it", e.Provider, e.Provider)
}

// IsPrivate reports whether err is a refusal by the privacy gate.
func IsPrivate(err error) bool {
	var p ErrPrivate
	return errors.As(err, &p)
}

// Origin says where a prompt's content came from, so Complete can decide
// whether the provider may see it.
type Origin struct {
	plane bool
	// keys are the Plane lock keys of every project and module the content
	// came from ("project:ENG", "module:<id>").
	keys []string
}

// Local is content the user wrote or pasted in Relay: an article, or text
// for an idea. It isn't Plane data, so any provider may see it.
func Local() Origin { return Origin{} }

// Plane is content built from Plane work items. Pass the lock key of every
// project and module involved; plane.PrivacyKeys gives them for an item.
// Plane data with no keys is treated as private: an empty list is a bug in
// the caller, and failing closed costs a retry, not a leak.
func Plane(keys ...string) Origin { return Origin{plane: true, keys: slices.Clone(keys)} }

// Private reports whether the content may only go to a trusted provider. It
// looks at the lockable list, not at what's unlocked right now.
func (o Origin) Private() bool {
	if !o.plane {
		return false
	}
	if len(o.keys) == 0 {
		return true
	}
	locked := config.GetConfig().Privacy.Locked
	return slices.ContainsFunc(o.keys, func(k string) bool { return slices.Contains(locked, k) })
}

// Private reports whether the provider is a private provider for the
// endpoint it uses now, and so may see private content.
//
// config AI.Private holds the user's choices: an endpoint marks the provider
// private for that endpoint only, and "" marks it not private. Without a
// choice, PrivateByDefault providers are private at their default endpoint.
func (c *Client) Private(id string) bool {
	endpoint := c.Endpoint(id)
	if marked, ok := config.GetConfig().AI.Private[id]; ok {
		return marked != "" && marked == endpoint
	}
	p, ok := Find(id)
	return ok && p.PrivateByDefault && endpoint == c.Default(id)
}

// allow is the gate. Refusals are logged without the content or the project.
func (c *Client) allow(p Provider, origin Origin) error {
	if !origin.Private() || c.Private(p.ID) {
		return nil
	}
	log.Notice("refused: private content to an untrusted provider", "provider", p.ID)
	return ErrPrivate{Provider: p.Name}
}
