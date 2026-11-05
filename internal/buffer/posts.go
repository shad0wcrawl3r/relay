package buffer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Channel is a social account connected to Buffer.
type Channel struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	DisplayName    string `json:"displayName"`
	Service        string `json:"service"`
	Avatar         string `json:"avatar"`
	Descriptor     string `json:"descriptor"`
	IsQueuePaused  bool   `json:"isQueuePaused"`
	IsDisconnected bool   `json:"isDisconnected"`
	IsLocked       bool   `json:"isLocked"`
	Timezone       string `json:"timezone"`
	ExternalLink   string `json:"externalLink"`
	OrganizationID string `json:"organizationId"`
	// PostingSchedule is empty when Buffer hasn't set one.
	PostingSchedule []ScheduleDay `json:"postingSchedule"`
	PostingGoal     *PostingGoal  `json:"postingGoal"`
}

// Channels lists the channels across every organization on the account.
func (c *Client) Channels(ctx context.Context) ([]Channel, error) {
	account, err := c.Account(ctx)
	if err != nil {
		return nil, err
	}
	return c.ChannelsIn(ctx, account.Organizations)
}

// ChannelsIn lists the channels of the given organizations.
func (c *Client) ChannelsIn(ctx context.Context, orgs []Organization) ([]Channel, error) {
	channels := []Channel{}
	for _, org := range orgs {
		var data struct {
			Channels []Channel `json:"channels"`
		}
		q := `query Channels($org: OrganizationId!) { channels(input: { organizationId: $org }) { ` + channelFields + ` } }`
		if err := c.queryVars(ctx, q, map[string]any{"org": org.ID}, &data); err != nil {
			return nil, err
		}
		for i := range data.Channels {
			if data.Channels[i].PostingSchedule == nil {
				data.Channels[i].PostingSchedule = []ScheduleDay{}
			}
		}
		channels = append(channels, data.Channels...)
	}
	log.Debug("channels loaded", "organizations", len(orgs), "channels", len(channels))
	return channels, nil
}

// quote renders a GraphQL string. GraphQL's escapes are a subset of JSON's
// that covers everything json.Marshal emits.
func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// Timing says when Buffer should publish a post.
type Timing string

const (
	Queue    Timing = "queue"
	Schedule Timing = "schedule"
	Draft    Timing = "draft"
)

// NewPost is one post for one channel.
type NewPost struct {
	ChannelID string
	Text      string
	Timing    Timing
	DueAt     time.Time
}

func createPostInput(p NewPost) (string, error) {
	if p.ChannelID == "" {
		return "", errors.New("choose a channel")
	}
	if strings.TrimSpace(p.Text) == "" {
		return "", errors.New("the post is empty")
	}
	base := fmt.Sprintf(`text: %s, channelId: %s, schedulingType: automatic`, quote(p.Text), quote(p.ChannelID))
	switch p.Timing {
	case Queue:
		return base + `, mode: addToQueue`, nil
	case Draft:
		return base + `, mode: addToQueue, saveToDraft: true`, nil
	case Schedule:
		if !p.DueAt.After(time.Now()) {
			return "", errors.New("pick a time in the future")
		}
		return base + fmt.Sprintf(`, mode: customScheduled, dueAt: %s`, quote(p.DueAt.UTC().Format("2006-01-02T15:04:05.000Z"))), nil
	}
	return "", fmt.Errorf("unknown timing %q", p.Timing)
}

// CreatePost sends one post to Buffer and returns its ID.
func (c *Client) CreatePost(ctx context.Context, p NewPost) (string, error) {
	input, err := createPostInput(p)
	if err != nil {
		return "", err
	}
	q := fmt.Sprintf(`mutation { createPost(input: { %s }) { ... on PostActionSuccess { post { id } } ... on MutationError { message } } }`, input)
	var data struct {
		CreatePost struct {
			Post struct {
				ID string `json:"id"`
			} `json:"post"`
			Message string `json:"message"`
		} `json:"createPost"`
	}
	if err := c.query(ctx, q, &data); err != nil {
		return "", err
	}
	if data.CreatePost.Post.ID == "" {
		log.Warn("post refused", "channel", p.ChannelID, "timing", p.Timing, "reason", data.CreatePost.Message)
		if data.CreatePost.Message != "" {
			return "", fmt.Errorf("Buffer: %s", data.CreatePost.Message)
		}
		return "", errors.New("Buffer didn't confirm the post")
	}
	log.Notice("post created", "id", data.CreatePost.Post.ID, "channel", p.ChannelID, "timing", p.Timing, "chars", len(p.Text))
	return data.CreatePost.Post.ID, nil
}
