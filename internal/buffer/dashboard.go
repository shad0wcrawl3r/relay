package buffer

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
)

// The Buffer tab reads posts, ideas and channel settings. Post text and idea
// content are the user's writing: log IDs and counts, never the text.

// Limits are the organization's plan limits.
type Limits struct {
	Channels       int `json:"channels"`
	ScheduledPosts int `json:"scheduledPosts"`
	Ideas          int `json:"ideas"`
	Tags           int `json:"tags"`
}

// ScheduleDay is one day of a channel's posting schedule. Times are HH:MM in
// the channel's timezone.
type ScheduleDay struct {
	Day    string   `json:"day"`
	Paused bool     `json:"paused"`
	Times  []string `json:"times"`
}

// PostingGoal is the channel's weekly target. Status is OnTrack, AtRisk or Hit.
type PostingGoal struct {
	Goal           int    `json:"goal"`
	SentCount      int    `json:"sentCount"`
	ScheduledCount int    `json:"scheduledCount"`
	Status         string `json:"status"`
}

const channelFields = `id name displayName service avatar descriptor isQueuePaused isDisconnected isLocked timezone externalLink organizationId
	postingSchedule { day paused times } postingGoal { goal sentCount scheduledCount status }`

const postFields = `id text status dueAt sentAt createdAt channelId channelService externalLink allowedActions
	error { message supportUrl } tags { name color } assets { thumbnail type } author { name }`

// PostStatuses are Buffer's post states, in the order the tab shows them.
var PostStatuses = []string{"scheduled", "needs_approval", "draft", "sent", "error", "sending"}

// Post is a post in Buffer, whoever made it.
type Post struct {
	ID             string   `json:"id"`
	Text           string   `json:"text"`
	Status         string   `json:"status"`
	DueAt          string   `json:"dueAt"`
	SentAt         string   `json:"sentAt"`
	CreatedAt      string   `json:"createdAt"`
	ChannelID      string   `json:"channelId"`
	ChannelService string   `json:"channelService"`
	ExternalLink   string   `json:"externalLink"`
	Actions        []string `json:"actions"`
	Error          string   `json:"error"`
	ErrorHelp      string   `json:"errorHelp"`
	Tags           []Tag    `json:"tags"`
	Images         []string `json:"images"`
	Author         string   `json:"author"`
}

type Tag struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

type rawPost struct {
	ID             string   `json:"id"`
	Text           string   `json:"text"`
	Status         string   `json:"status"`
	DueAt          string   `json:"dueAt"`
	SentAt         string   `json:"sentAt"`
	CreatedAt      string   `json:"createdAt"`
	ChannelID      string   `json:"channelId"`
	ChannelService string   `json:"channelService"`
	ExternalLink   string   `json:"externalLink"`
	AllowedActions []string `json:"allowedActions"`
	Error          *struct {
		Message    string `json:"message"`
		SupportURL string `json:"supportUrl"`
	} `json:"error"`
	Tags   []Tag `json:"tags"`
	Assets []struct {
		Thumbnail string `json:"thumbnail"`
		Type      string `json:"type"`
	} `json:"assets"`
	Author *struct {
		Name string `json:"name"`
	} `json:"author"`
}

func (r rawPost) post() Post {
	p := Post{
		ID: r.ID, Text: r.Text, Status: r.Status, DueAt: r.DueAt, SentAt: r.SentAt, CreatedAt: r.CreatedAt,
		ChannelID: r.ChannelID, ChannelService: r.ChannelService, ExternalLink: r.ExternalLink,
		Actions: r.AllowedActions, Tags: r.Tags, Images: []string{},
	}
	if p.Actions == nil {
		p.Actions = []string{}
	}
	if p.Tags == nil {
		p.Tags = []Tag{}
	}
	if r.Error != nil {
		p.Error, p.ErrorHelp = r.Error.Message, r.Error.SupportURL
	}
	if r.Author != nil {
		p.Author = r.Author.Name
	}
	for _, a := range r.Assets {
		if a.Thumbnail != "" {
			p.Images = append(p.Images, a.Thumbnail)
		}
	}
	return p
}

// PostQuery selects one page of posts.
type PostQuery struct {
	OrganizationID string   `json:"organizationId"`
	Statuses       []string `json:"statuses"`
	ChannelIDs     []string `json:"channelIds"`
	After          string   `json:"after"`
}

type PostPage struct {
	Posts  []Post `json:"posts"`
	Cursor string `json:"cursor"`
	More   bool   `json:"more"`
}

const pageSize = 25

// postSort puts what's next first for the queue, and what's newest first for
// everything else.
func postSort(statuses []string) []map[string]string {
	upcoming := len(statuses) > 0
	for _, s := range statuses {
		if s != "scheduled" && s != "needs_approval" && s != "sending" {
			upcoming = false
		}
	}
	switch {
	case upcoming:
		return []map[string]string{{"field": "dueAt", "direction": "asc"}}
	case slices.Contains(statuses, "draft"):
		return []map[string]string{{"field": "createdAt", "direction": "desc"}}
	}
	return []map[string]string{{"field": "dueAt", "direction": "desc"}, {"field": "createdAt", "direction": "desc"}}
}

// Posts returns one page of the organization's posts.
func (c *Client) Posts(ctx context.Context, q PostQuery) (PostPage, error) {
	if q.OrganizationID == "" {
		return PostPage{}, errors.New("choose a Buffer organization")
	}
	for _, s := range q.Statuses {
		if !slices.Contains(PostStatuses, s) {
			return PostPage{}, fmt.Errorf("unknown post status %q", s)
		}
	}
	filter := map[string]any{}
	if len(q.Statuses) > 0 {
		filter["status"] = q.Statuses
	}
	if len(q.ChannelIDs) > 0 {
		filter["channelIds"] = q.ChannelIDs
	}
	vars := map[string]any{
		"first": pageSize,
		"input": map[string]any{"organizationId": q.OrganizationID, "filter": filter, "sort": postSort(q.Statuses)},
	}
	if q.After != "" {
		vars["after"] = q.After
	}
	var data struct {
		Posts struct {
			Edges []struct {
				Node rawPost `json:"node"`
			} `json:"edges"`
			PageInfo struct {
				HasNextPage bool   `json:"hasNextPage"`
				EndCursor   string `json:"endCursor"`
			} `json:"pageInfo"`
		} `json:"posts"`
	}
	err := c.queryVars(ctx, `query Posts($input: PostsInput!, $first: Int, $after: String) {
		posts(input: $input, first: $first, after: $after) { edges { node { `+postFields+` } } pageInfo { hasNextPage endCursor } } }`, vars, &data)
	if err != nil {
		return PostPage{}, err
	}
	page := PostPage{Posts: make([]Post, 0, len(data.Posts.Edges)), Cursor: data.Posts.PageInfo.EndCursor, More: data.Posts.PageInfo.HasNextPage}
	for _, e := range data.Posts.Edges {
		page.Posts = append(page.Posts, e.Node.post())
	}
	log.Debug("posts loaded", "statuses", strings.Join(q.Statuses, ","), "count", len(page.Posts), "more", page.More)
	return page, nil
}

// DeletePost removes a post from Buffer.
func (c *Client) DeletePost(ctx context.Context, id string) error {
	if id == "" {
		return errors.New("no post to delete")
	}
	var data struct {
		DeletePost struct {
			ID      string `json:"id"`
			Message string `json:"message"`
		} `json:"deletePost"`
	}
	err := c.queryVars(ctx, `mutation DeletePost($input: DeletePostInput!) {
		deletePost(input: $input) { ... on DeletePostSuccess { id } ... on VoidMutationError { message } } }`,
		map[string]any{"input": map[string]any{"id": id}}, &data)
	if err != nil {
		return err
	}
	if data.DeletePost.ID == "" {
		return refusal(data.DeletePost.Message, "Buffer didn't confirm the delete")
	}
	log.Notice("post deleted", "id", id)
	return nil
}

// PostEdit changes a post's text and, when DueAt is set, its time.
type PostEdit struct {
	ID    string    `json:"id"`
	Text  string    `json:"text"`
	DueAt time.Time `json:"dueAt"`
}

// EditPost updates a post and returns it as Buffer now has it.
func (c *Client) EditPost(ctx context.Context, e PostEdit) (Post, error) {
	if e.ID == "" {
		return Post{}, errors.New("no post to edit")
	}
	if strings.TrimSpace(e.Text) == "" {
		return Post{}, errors.New("the post is empty")
	}
	input := map[string]any{"id": e.ID, "text": e.Text}
	if !e.DueAt.IsZero() {
		if !e.DueAt.After(time.Now()) {
			return Post{}, errors.New("pick a time in the future")
		}
		input["mode"] = "customScheduled"
		input["schedulingType"] = "automatic"
		input["dueAt"] = e.DueAt.UTC().Format("2006-01-02T15:04:05.000Z")
	}
	var data struct {
		EditPost struct {
			Post    *rawPost `json:"post"`
			Message string   `json:"message"`
		} `json:"editPost"`
	}
	err := c.queryVars(ctx, `mutation EditPost($input: EditPostInput!) {
		editPost(input: $input) { ... on PostActionSuccess { post { `+postFields+` } } ... on MutationError { message } } }`,
		map[string]any{"input": input}, &data)
	if err != nil {
		return Post{}, err
	}
	if data.EditPost.Post == nil {
		return Post{}, refusal(data.EditPost.Message, "Buffer didn't confirm the edit")
	}
	log.Notice("post edited", "id", e.ID, "rescheduled", !e.DueAt.IsZero(), "chars", len(e.Text))
	return data.EditPost.Post.post(), nil
}

// Idea is a saved idea in Buffer's Create space. CreatedAt is Unix seconds.
type Idea struct {
	ID        string   `json:"id"`
	GroupID   string   `json:"groupId"`
	Title     string   `json:"title"`
	Text      string   `json:"text"`
	Services  []string `json:"services"`
	CreatedAt int64    `json:"createdAt"`
}

type IdeaGroup struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	IsLocked bool   `json:"isLocked"`
}

type IdeaPage struct {
	Ideas  []Idea      `json:"ideas"`
	Groups []IdeaGroup `json:"groups"`
	Cursor string      `json:"cursor"`
	More   bool        `json:"more"`
}

type rawIdea struct {
	ID        string `json:"id"`
	GroupID   string `json:"groupId"`
	CreatedAt int64  `json:"createdAt"`
	Content   struct {
		Title    string   `json:"title"`
		Text     string   `json:"text"`
		Services []string `json:"services"`
	} `json:"content"`
}

func (r rawIdea) idea() Idea {
	i := Idea{ID: r.ID, GroupID: r.GroupID, Title: r.Content.Title, Text: r.Content.Text, Services: r.Content.Services, CreatedAt: r.CreatedAt}
	if i.Services == nil {
		i.Services = []string{}
	}
	return i
}

// Ideas returns a page of the organization's ideas, with its idea groups on
// the first page.
func (c *Client) Ideas(ctx context.Context, orgID, after string) (IdeaPage, error) {
	if orgID == "" {
		return IdeaPage{}, errors.New("choose a Buffer organization")
	}
	vars := map[string]any{"first": pageSize, "input": map[string]any{"organizationId": orgID}}
	if after != "" {
		vars["after"] = after
	}
	var data struct {
		Ideas struct {
			Edges []struct {
				Node rawIdea `json:"node"`
			} `json:"edges"`
			PageInfo struct {
				HasNextPage bool   `json:"hasNextPage"`
				EndCursor   string `json:"endCursor"`
			} `json:"pageInfo"`
		} `json:"ideas"`
		IdeaGroups []IdeaGroup `json:"ideaGroups"`
	}
	groups := ""
	if after == "" {
		groups = ` ideaGroups(input: { organizationId: $org }) { id name isLocked }`
		vars["org"] = orgID
	}
	decl := `$input: IdeasInput!, $first: Int, $after: String`
	if groups != "" {
		decl += `, $org: ID!`
	}
	err := c.queryVars(ctx, `query Ideas(`+decl+`) {
		ideas(input: $input, first: $first, after: $after) { edges { node { id groupId createdAt content { title text services } } } pageInfo { hasNextPage endCursor } }`+groups+` }`, vars, &data)
	if err != nil {
		return IdeaPage{}, err
	}
	page := IdeaPage{Ideas: make([]Idea, 0, len(data.Ideas.Edges)), Groups: data.IdeaGroups, Cursor: data.Ideas.PageInfo.EndCursor, More: data.Ideas.PageInfo.HasNextPage}
	if page.Groups == nil {
		page.Groups = []IdeaGroup{}
	}
	for _, e := range data.Ideas.Edges {
		page.Ideas = append(page.Ideas, e.Node.idea())
	}
	log.Debug("ideas loaded", "count", len(page.Ideas), "groups", len(page.Groups), "more", page.More)
	return page, nil
}

// NewIdea is an idea to save in Buffer. Ideas are never published on their
// own, so they don't need a Dev.to link.
type NewIdea struct {
	OrganizationID string `json:"organizationId"`
	GroupID        string `json:"groupId"`
	Title          string `json:"title"`
	Text           string `json:"text"`
}

// CreateIdea saves an idea and returns it.
func (c *Client) CreateIdea(ctx context.Context, n NewIdea) (Idea, error) {
	if n.OrganizationID == "" {
		return Idea{}, errors.New("choose a Buffer organization")
	}
	if strings.TrimSpace(n.Text) == "" && strings.TrimSpace(n.Title) == "" {
		return Idea{}, errors.New("the idea is empty")
	}
	content := map[string]any{"text": strings.TrimSpace(n.Text)}
	if t := strings.TrimSpace(n.Title); t != "" {
		content["title"] = t
	}
	input := map[string]any{"organizationId": n.OrganizationID, "content": content}
	if n.GroupID != "" {
		input["group"] = map[string]any{"groupId": n.GroupID}
	}
	var data struct {
		CreateIdea struct {
			rawIdea
			Idea    *rawIdea `json:"idea"`
			Message string   `json:"message"`
		} `json:"createIdea"`
	}
	const fields = `id groupId createdAt content { title text services }`
	err := c.queryVars(ctx, `mutation CreateIdea($input: CreateIdeaInput!) {
		createIdea(input: $input) { ... on Idea { `+fields+` } ... on IdeaResponse { idea { `+fields+` } } ... on MutationError { message } } }`,
		map[string]any{"input": input}, &data)
	if err != nil {
		return Idea{}, err
	}
	got := data.CreateIdea.rawIdea
	if data.CreateIdea.Idea != nil {
		got = *data.CreateIdea.Idea
	}
	if got.ID == "" {
		return Idea{}, refusal(data.CreateIdea.Message, "Buffer didn't confirm the idea")
	}
	log.Notice("idea created", "id", got.ID)
	return got.idea(), nil
}

func refusal(message, fallback string) error {
	if message != "" {
		return fmt.Errorf("Buffer: %s", message)
	}
	return errors.New(fallback)
}
