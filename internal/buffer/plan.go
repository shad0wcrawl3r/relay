package buffer

import (
	"context"
	"errors"
	"strings"
	"time"
)

// Planning on Buffer uses content items: Buffer's planning unit that starts as
// a channel-less draft and can later become channel posts. Unlike ideas, they
// can be retitled, dated, tagged and deleted through the API. Buffer marks
// the whole content item API Experimental, so keep every query here.

// ContentItem is a content item with only what planning needs.
type ContentItem struct {
	ID         string     `json:"id"`
	Title      string     `json:"title"`
	TargetDate string     `json:"targetDate"`
	CreatedAt  string     `json:"createdAt"`
	Tags       []OrgTag   `json:"tags"`
	CanDelete  bool       `json:"canDelete"`
	Draft      *ItemDraft `json:"draft"`
	Posts      []ItemPost `json:"posts"`
}

// ItemDraft is a content item's channel-less draft. HasAssets means Relay can't
// rewrite it without dropping attachments, so it won't retag it.
type ItemDraft struct {
	Text       string `json:"text"`
	AIAssisted bool   `json:"aiAssisted"`
	HasAssets  bool   `json:"hasAssets"`
}

// ItemPost is one of a content item's channel posts.
type ItemPost struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Text   string `json:"text"`
	DueAt  string `json:"dueAt"`
}

// OrgTag is an organization tag, as applied to posts, ideas and content items.
type OrgTag struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	IsLocked bool   `json:"isLocked"`
}

const contentItemFields = `id title targetDate createdAt allowedActions tags { id name color isLocked }
	body { __typename ... on DraftContent { text aiAssisted assets { id } } ... on PostContent { posts { id status text dueAt } } }`

type rawContentItem struct {
	ID             string   `json:"id"`
	Title          *string  `json:"title"`
	TargetDate     *string  `json:"targetDate"`
	CreatedAt      string   `json:"createdAt"`
	AllowedActions []string `json:"allowedActions"`
	Tags           []OrgTag `json:"tags"`
	Body           struct {
		Typename   string `json:"__typename"`
		Text       string `json:"text"`
		AIAssisted bool   `json:"aiAssisted"`
		Assets     []struct {
			ID string `json:"id"`
		} `json:"assets"`
		Posts []ItemPost `json:"posts"`
	} `json:"body"`
}

func (r rawContentItem) item() ContentItem {
	it := ContentItem{ID: r.ID, CreatedAt: r.CreatedAt, Tags: r.Tags, Posts: r.Body.Posts}
	if r.Title != nil {
		it.Title = *r.Title
	}
	if r.TargetDate != nil {
		it.TargetDate = *r.TargetDate
	}
	if it.Tags == nil {
		it.Tags = []OrgTag{}
	}
	for _, a := range r.AllowedActions {
		if a == "deleteContentItem" {
			it.CanDelete = true
		}
	}
	if r.Body.Typename == "DraftContent" {
		it.Draft = &ItemDraft{Text: r.Body.Text, AIAssisted: r.Body.AIAssisted, HasAssets: len(r.Body.Assets) > 0}
		it.Posts = nil
	} else if it.Posts == nil {
		it.Posts = []ItemPost{}
	}
	return it
}

// maxContentItems caps a board load: 5 pages of Buffer's 100-item maximum.
const maxContentItems = 500

// ContentItems lists an organization's content items, by target date.
func (c *Client) ContentItems(ctx context.Context, orgID string) ([]ContentItem, error) {
	if orgID == "" {
		return nil, errors.New("choose a Buffer organization")
	}
	out := []ContentItem{}
	after := ""
	for len(out) < maxContentItems {
		vars := map[string]any{
			"input": map[string]any{
				"organizationId": orgID,
				"sort":           []map[string]string{{"field": "targetDate", "direction": "asc"}, {"field": "createdAt", "direction": "desc"}},
			},
			"first": 100,
		}
		if after != "" {
			vars["after"] = after
		}
		var data struct {
			ContentItems struct {
				Edges []struct {
					Node rawContentItem `json:"node"`
				} `json:"edges"`
				PageInfo struct {
					HasNextPage bool   `json:"hasNextPage"`
					EndCursor   string `json:"endCursor"`
				} `json:"pageInfo"`
			} `json:"contentItems"`
		}
		err := c.queryVars(ctx, `query ContentItems($input: ContentItemsInput!, $first: Int, $after: String) {
			contentItems(input: $input, first: $first, after: $after) { edges { node { `+contentItemFields+` } } pageInfo { hasNextPage endCursor } } }`, vars, &data)
		if err != nil {
			return nil, err
		}
		for _, e := range data.ContentItems.Edges {
			out = append(out, e.Node.item())
		}
		if !data.ContentItems.PageInfo.HasNextPage || data.ContentItems.PageInfo.EndCursor == "" {
			break
		}
		after = data.ContentItems.PageInfo.EndCursor
	}
	log.Debug("content items loaded", "count", len(out))
	return out, nil
}

// Tags lists an organization's tags.
func (c *Client) Tags(ctx context.Context, orgID string) ([]OrgTag, error) {
	if orgID == "" {
		return nil, errors.New("choose a Buffer organization")
	}
	out := []OrgTag{}
	after := ""
	for range 10 {
		vars := map[string]any{"input": map[string]any{"organizationId": orgID}, "first": 100}
		if after != "" {
			vars["after"] = after
		}
		var data struct {
			TagsV2 struct {
				Edges []struct {
					Node OrgTag `json:"node"`
				} `json:"edges"`
				PageInfo struct {
					HasNextPage bool   `json:"hasNextPage"`
					EndCursor   string `json:"endCursor"`
				} `json:"pageInfo"`
			} `json:"tagsV2"`
		}
		err := c.queryVars(ctx, `query Tags($input: TagsInput!, $first: Int, $after: String) {
			tagsV2(input: $input, first: $first, after: $after) { edges { node { id name color isLocked } } pageInfo { hasNextPage endCursor } } }`, vars, &data)
		if err != nil {
			return nil, err
		}
		for _, e := range data.TagsV2.Edges {
			out = append(out, e.Node)
		}
		if !data.TagsV2.PageInfo.HasNextPage || data.TagsV2.PageInfo.EndCursor == "" {
			break
		}
		after = data.TagsV2.PageInfo.EndCursor
	}
	return out, nil
}

// CreateTag adds a tag to the organization. color is "#RRGGBB".
func (c *Client) CreateTag(ctx context.Context, orgID, name, color string) (OrgTag, error) {
	var data struct {
		CreateTag struct {
			Tag     *OrgTag `json:"tag"`
			Message string  `json:"message"`
		} `json:"createTag"`
	}
	err := c.queryVars(ctx, `mutation CreateTag($input: CreateTagInput!) {
		createTag(input: $input) { ... on TagActionSuccess { tag { id name color isLocked } } ... on MutationError { message } } }`,
		map[string]any{"input": map[string]any{"organizationId": orgID, "tag": map[string]any{"name": name, "color": color}}}, &data)
	if err != nil {
		return OrgTag{}, err
	}
	if data.CreateTag.Tag == nil {
		return OrgTag{}, refusal(data.CreateTag.Message, "Buffer didn't create the tag "+name)
	}
	log.Notice("tag created")
	return *data.CreateTag.Tag, nil
}

// NewContentItem is a planning card to create as a channel-less draft.
type NewContentItem struct {
	OrganizationID string
	Title          string
	Text           string
	TagIDs         []string
	// TargetDate is YYYY-MM-DD, or empty.
	TargetDate string
}

// CreateContentItem creates a content item holding a channel-less draft.
// Buffer needs draft text, so a card with only a title uses it as the text.
func (c *Client) CreateContentItem(ctx context.Context, n NewContentItem) (ContentItem, error) {
	title, text := strings.TrimSpace(n.Title), strings.TrimSpace(n.Text)
	if title == "" && text == "" {
		return ContentItem{}, errors.New("the card is empty")
	}
	if text == "" {
		text = title
	}
	input := map[string]any{
		"organizationId": n.OrganizationID,
		"draft":          map[string]any{"text": text, "aiAssisted": false, "assets": []any{}},
		"tagIds":         nonNil(n.TagIDs),
	}
	if title != "" {
		input["title"] = title
	}
	if d, ok := dateTime(n.TargetDate); ok {
		input["targetDate"] = d
	}
	var data struct {
		Create struct {
			ContentItem *rawContentItem `json:"contentItem"`
			Message     string          `json:"message"`
		} `json:"createContentItemDraft"`
	}
	err := c.queryVars(ctx, `mutation CreateContentItemDraft($input: CreateContentItemDraftInput!) {
		createContentItemDraft(input: $input) { ... on CreateContentItemDraftSuccess { contentItem { `+contentItemFields+` } } ... on MutationError { message } } }`,
		map[string]any{"input": input}, &data)
	if err != nil {
		return ContentItem{}, err
	}
	if data.Create.ContentItem == nil {
		return ContentItem{}, refusal(data.Create.Message, "Buffer didn't create the card")
	}
	log.Notice("content item created", "id", data.Create.ContentItem.ID)
	return data.Create.ContentItem.item(), nil
}

// ContentItemEdit changes a content item's title or target date. A nil field
// is left alone; an empty TargetDate clears it.
type ContentItemEdit struct {
	ID         string
	Title      *string
	TargetDate *string
}

// EditContentItem retitles or redates a content item, draft or not.
func (c *Client) EditContentItem(ctx context.Context, e ContentItemEdit) error {
	input := map[string]any{"id": e.ID}
	if e.Title != nil {
		input["title"] = strings.TrimSpace(*e.Title)
	}
	if e.TargetDate != nil {
		if d, ok := dateTime(*e.TargetDate); ok {
			input["targetDate"] = d
		} else {
			input["targetDate"] = nil
		}
	}
	var data struct {
		Update struct {
			ContentItem *struct {
				ID string `json:"id"`
			} `json:"contentItem"`
			Message string `json:"message"`
		} `json:"updateContentItem"`
	}
	err := c.queryVars(ctx, `mutation UpdateContentItem($input: UpdateContentItemInput!) {
		updateContentItem(input: $input) { ... on UpdateContentItemSuccess { contentItem { id } } ... on MutationError { message } } }`,
		map[string]any{"input": input}, &data)
	if err != nil {
		return err
	}
	if data.Update.ContentItem == nil {
		return refusal(data.Update.Message, "Buffer didn't update the card")
	}
	return nil
}

// ErrNotDraft means the content item already holds channel posts, so its
// tags can no longer be changed through the API.
var ErrNotDraft = errors.New("this card already has posts in Buffer, so it can't move between columns any more")

// ErrHasAssets means retagging would drop the draft's attachments.
var ErrHasAssets = errors.New("this card's draft has attachments; move it in Buffer so they aren't lost")

// SetContentItemTags replaces a draft content item's tags. Buffer only takes
// tags together with the full draft, so it sends the draft back unchanged.
func (c *Client) SetContentItemTags(ctx context.Context, it ContentItem, tagIDs []string) error {
	if it.Draft == nil {
		return ErrNotDraft
	}
	if it.Draft.HasAssets {
		return ErrHasAssets
	}
	input := map[string]any{
		"id":     it.ID,
		"draft":  map[string]any{"text": it.Draft.Text, "aiAssisted": it.Draft.AIAssisted, "assets": []any{}},
		"tagIds": nonNil(tagIDs),
	}
	var data struct {
		Update struct {
			ContentItem *struct {
				ID string `json:"id"`
			} `json:"contentItem"`
			Message string `json:"message"`
		} `json:"updateContentItemDraft"`
	}
	err := c.queryVars(ctx, `mutation UpdateContentItemDraft($input: UpdateContentItemDraftInput!) {
		updateContentItemDraft(input: $input) { ... on UpdateContentItemDraftSuccess { contentItem { id } } ... on MutationError { message } } }`,
		map[string]any{"input": input}, &data)
	if err != nil {
		return err
	}
	if data.Update.ContentItem == nil {
		return refusal(data.Update.Message, "Buffer didn't move the card")
	}
	return nil
}

// dateTime turns YYYY-MM-DD into the DateTime Buffer wants, at noon UTC so
// the day doesn't shift in any time zone Buffer shows it in.
func dateTime(day string) (string, bool) {
	t, err := time.Parse("2006-01-02", strings.TrimSpace(day))
	if err != nil {
		return "", false
	}
	return t.Add(12 * time.Hour).UTC().Format(time.RFC3339), true
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
