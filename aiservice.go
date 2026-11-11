package main

import (
	"context"
	"errors"
	"maps"
	"strings"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/ai"
	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// AIService connects a model provider. Keys go to the keychain and never come
// back to the frontend, which only learns whether one is set.
type AIService struct {
	client *ai.Client
	posts  *PostService
}

func NewAIService(posts *PostService) *AIService {
	return &AIService{client: ai.New(), posts: posts}
}

type AIProvider struct {
	ai.Provider
	KeySet bool `json:"keySet"`
	// Endpoint is the base URL in use; Custom says it isn't the default.
	Endpoint        string `json:"endpoint"`
	DefaultEndpoint string `json:"defaultEndpoint"`
	Custom          bool   `json:"custom"`
	// Private: a private provider, so it may read private projects.
	Private bool `json:"private"`
}

type AIStatus struct {
	Providers []AIProvider `json:"providers"`
	// Provider and Model are the selection used for summaries.
	Provider string `json:"provider"`
	Model    string `json:"model"`
	// Ready is true once a usable provider and model are selected.
	Ready bool `json:"ready"`
	// Label names the selection, e.g. "Ollama · llama3".
	Label string `json:"label"`
	Local bool   `json:"local"`
	// Private: the selected provider may read private projects.
	Private bool `json:"private"`
	// Preloadable: the selection is Ollama or LM Studio on this machine.
	Preloadable bool `json:"preloadable"`
	// Preload: the setting to warm a local model before it's asked.
	Preload bool `json:"preload"`
}

func (s *AIService) Status() AIStatus {
	c := config.GetConfig()
	st := AIStatus{Providers: []AIProvider{}, Provider: c.AI.Provider, Model: c.AI.Model}
	for _, p := range ai.Providers() {
		p.Local = s.client.Local(p.ID)
		endpoint, fallback := s.client.Endpoint(p.ID), s.client.Default(p.ID)
		st.Providers = append(st.Providers, AIProvider{
			Provider: p, KeySet: ai.HasKey(p.ID),
			Endpoint: endpoint, DefaultEndpoint: fallback, Custom: endpoint != fallback,
			Private: s.client.Private(p.ID),
		})
	}
	if p, ok := ai.Find(c.AI.Provider); ok && c.AI.Model != "" && (!p.NeedsKey || ai.HasKey(p.ID)) {
		st.Ready, st.Local, st.Label = true, s.client.Local(p.ID), p.Name+" · "+c.AI.Model
		st.Private = s.client.Private(p.ID)
		st.Preloadable = s.client.Preloadable(p.ID)
	}
	st.Preload = c.AI.Preload
	return st
}

// Models lists a provider's models, which also tests the connection.
func (s *AIService) Models(ctx context.Context, provider string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	return s.client.Models(ctx, provider)
}

func (s *AIService) SetKey(provider, key string) (AIStatus, error) {
	if err := ai.SetKey(provider, key); err != nil {
		return AIStatus{}, err
	}
	return s.Status(), nil
}

func (s *AIService) ClearKey(provider string) (AIStatus, error) {
	if err := ai.ClearKey(provider); err != nil {
		return AIStatus{}, err
	}
	return s.Status(), nil
}

// SetEndpoint overrides a provider's base URL; empty restores the default.
func (s *AIService) SetEndpoint(provider, endpoint string) (AIStatus, error) {
	if _, ok := ai.Find(provider); !ok {
		return AIStatus{}, errors.New("unknown provider")
	}
	endpoint, err := ai.NormaliseEndpoint(endpoint)
	if err != nil {
		return AIStatus{}, err
	}
	err = config.Update(func(c *config.Config) {
		next := maps.Clone(c.AI.Endpoints)
		if next == nil {
			next = map[string]string{}
		}
		if endpoint == "" {
			delete(next, provider)
		} else {
			next[provider] = endpoint
		}
		c.AI.Endpoints = next
		// A private mark covers the address it was given for, not a new one.
		// An explicit "not private" stays.
		if marked, ok := c.AI.Private[provider]; ok && marked != "" {
			private := maps.Clone(c.AI.Private)
			delete(private, provider)
			c.AI.Private = private
		}
	})
	if err != nil {
		return AIStatus{}, err
	}
	logs.For("ai").Notice("endpoint changed", "provider", provider, "custom", endpoint != "")
	return s.Status(), nil
}

// SetPrivate marks a provider as private for its current endpoint, or as
// not private. Either way it's an explicit choice that overrides
// PrivateByDefault.
func (s *AIService) SetPrivate(provider string, private bool) (AIStatus, error) {
	if _, ok := ai.Find(provider); !ok {
		return AIStatus{}, errors.New("unknown provider")
	}
	endpoint := s.client.Endpoint(provider)
	err := config.Update(func(c *config.Config) {
		next := maps.Clone(c.AI.Private)
		if next == nil {
			next = map[string]string{}
		}
		if private {
			next[provider] = endpoint
		} else {
			next[provider] = ""
		}
		c.AI.Private = next
	})
	if err != nil {
		return AIStatus{}, err
	}
	logs.For("ai").Notice("private mark changed", "provider", provider, "private", private)
	return s.Status(), nil
}

// Select chooses the provider and model used for summaries.
func (s *AIService) Select(provider, model string) (AIStatus, error) {
	err := config.Update(func(c *config.Config) {
		c.AI.Provider, c.AI.Model = provider, model
	})
	if err != nil {
		return AIStatus{}, err
	}
	return s.Status(), nil
}

// ModelTest is the result of a short test prompt.
type ModelTest struct {
	Reply string `json:"reply"`
	Ms    int64  `json:"ms"`
}

// TestModel sends a one-line prompt to provider and model, so Settings can
// check a choice works before saving it. The prompt holds no user data.
func (s *AIService) TestModel(ctx context.Context, provider, model string) (ModelTest, error) {
	if strings.TrimSpace(model) == "" {
		return ModelTest{}, errors.New("choose a model first")
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	start := time.Now()
	reply, err := s.client.Complete(ctx, ai.Local(), provider, model,
		"You are answering a connection test.", "Reply with the single word OK.")
	if err != nil {
		return ModelTest{}, err
	}
	if r := []rune(reply); len(r) > 80 {
		reply = string(r[:80]) + "…"
	}
	return ModelTest{Reply: reply, Ms: time.Since(start).Milliseconds()}, nil
}

// SummarizeText drafts a social post from pasted text, for when there's no
// local article (no Dev.to account, or writing that lives elsewhere). It only
// runs when the user asks.
func (s *AIService) SummarizeText(ctx context.Context, title, text string) (string, error) {
	st := s.Status()
	if !st.Ready {
		return "", ai.ErrNoProvider
	}
	if strings.TrimSpace(text) == "" {
		return "", errors.New("paste some text first")
	}
	if strings.TrimSpace(title) == "" {
		title = "Untitled"
	}
	system, user := ai.LinkedInPrompt(ai.Article{Title: title, Body: text})
	// Text the user pasted, not Plane data.
	return s.client.Complete(ctx, ai.Local(), st.Provider, st.Model, system, user)
}

// DraftPost rewrites the user's notes as a social post that fits limit
// characters (the strictest of the chosen channels). It only runs when the
// user asks.
func (s *AIService) DraftPost(ctx context.Context, notes string, limit int) (string, error) {
	st := s.Status()
	if !st.Ready {
		return "", ai.ErrNoProvider
	}
	if strings.TrimSpace(notes) == "" {
		return "", errors.New("write a few notes first")
	}
	system, user := ai.SocialPrompt(notes, limit)
	// Text the user typed, not Plane data.
	return s.client.Complete(ctx, ai.Local(), st.Provider, st.Model, system, user)
}

// SummarizePost drafts a LinkedIn post from a local article. It only runs when
// the user asks, because it sends the article to the selected provider.
func (s *AIService) SummarizePost(ctx context.Context, id string) (string, error) {
	st := s.Status()
	if !st.Ready {
		return "", ai.ErrNoProvider
	}
	p, err := s.posts.Get(id)
	if err != nil {
		return "", err
	}
	system, user := ai.LinkedInPrompt(ai.Article{
		Title: p.Title, Series: p.Series, Tags: p.Tags, Description: p.Description, Body: s.posts.articleBody(p),
	})
	return s.client.Complete(ctx, ai.Local(), st.Provider, st.Model, system, user)
}

// SetPreload turns preloading local models on or off.
func (s *AIService) SetPreload(on bool) (AIStatus, error) {
	if err := config.Update(func(c *config.Config) { c.AI.Preload = on }); err != nil {
		return AIStatus{}, err
	}
	return s.Status(), nil
}

// AIPreload is sent as "ai:preload" while a model loads.
type AIPreload struct {
	// State is "loading", "ready" or "failed".
	State string `json:"state"`
	Label string `json:"label"`
}

// Preload starts loading the selected local model into memory, for a dialog
// that's about to ask it. It returns at once; progress comes as "ai:preload"
// events. It does nothing when the setting is off, the selection isn't a
// local Ollama or LM Studio, or the model was loaded a few minutes ago.
func (s *AIService) Preload() {
	c := config.GetConfig()
	if !c.AI.Preload || c.AI.Model == "" || !s.client.Preloadable(c.AI.Provider) {
		return
	}
	p, _ := ai.Find(c.AI.Provider)
	label := p.Name + " · " + c.AI.Model
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		emit := func(state string) {
			if app := application.Get(); app != nil {
				app.Event.Emit("ai:preload", AIPreload{State: state, Label: label})
			}
		}
		emit("loading")
		if err := s.client.Preload(ctx, c.AI.Provider, c.AI.Model); err != nil {
			emit("failed")
			return
		}
		emit("ready")
	}()
}
