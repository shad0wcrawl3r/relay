package main

import (
	"context"
	"errors"

	"github.com/shad0wcrawl3r/relay/internal/buffer"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// BufferService exposes the Buffer sign-in to the frontend. Tokens stay in Go.
type BufferService struct {
	client *buffer.Client
}

func NewBufferService() *BufferService {
	return &BufferService{client: buffer.New()}
}

type BufferStatus struct {
	Connected bool   `json:"connected"`
	Account   string `json:"account"`
}

// Status looks up the account when signed in. A failed lookup still reports
// connected: being offline isn't the same as being signed out.
func (s *BufferService) Status(ctx context.Context) BufferStatus {
	if !s.client.Connected() {
		return BufferStatus{}
	}
	a, err := s.client.Account(ctx)
	if errors.Is(err, buffer.ErrNotConnected) {
		return BufferStatus{}
	}
	st := BufferStatus{Connected: true, Account: a.Name}
	if st.Account == "" {
		st.Account = a.Email
	}
	return st
}

func (s *BufferService) Connect(ctx context.Context) (BufferStatus, error) {
	err := s.client.Connect(ctx, func(u string) { _ = application.Get().Browser.OpenURL(u) })
	if err != nil {
		return BufferStatus{}, err
	}
	return s.Status(ctx), nil
}

func (s *BufferService) Disconnect() error {
	return s.client.Disconnect()
}
