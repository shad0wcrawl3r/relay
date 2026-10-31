package main

import (
	"context"
	"errors"
	"maps"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/ai"
	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
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
		})
	}
	if p, ok := ai.Find(c.AI.Provider); ok && c.AI.Model != "" && (!p.NeedsKey || ai.HasKey(p.ID)) {
		st.Ready, st.Local, st.Label = true, s.client.Local(p.ID), p.Name+" · "+c.AI.Model
	}
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
	})
	if err != nil {
		return AIStatus{}, err
	}
	logs.For("ai").Notice("endpoint changed", "provider", provider, "custom", endpoint != "")
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
	return s.client.Complete(ctx, st.Provider, st.Model, system, user)
}
