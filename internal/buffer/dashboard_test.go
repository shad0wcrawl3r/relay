package buffer

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

type gqlRequest struct {
	Query     string         `json:"query"`
	Variables map[string]any `json:"variables"`
}

// captureVars records the last request, variables included.
func captureVars(t *testing.T, reply string) (*Client, *gqlRequest) {
	t.Helper()
	got := &gqlRequest{}
	c := newClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		*got = gqlRequest{}
		_ = json.NewDecoder(r.Body).Decode(got)
		fmt.Fprint(w, reply)
	})
	seed(t, c, Token{AccessToken: "ok", Expiry: time.Now().Add(time.Hour)})
	return c, got
}

func jsonOf(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func TestPostsSendsFiltersAsVariables(t *testing.T) {
	c, got := captureVars(t, `{"data":{"posts":{"edges":[{"node":{
		"id":"p1","text":"hi","status":"error","dueAt":"2026-11-06T09:00:00.000Z","sentAt":null,"channelId":"c1",
		"allowedActions":["deletePost"],"error":{"message":"token expired","supportUrl":"https://help"},
		"tags":null,"assets":[{"thumbnail":"https://img","type":"image"}],"author":{"name":"Ash"}}}],
		"pageInfo":{"hasNextPage":true,"endCursor":"cur1"}}}}`)
	page, err := c.Posts(context.Background(), PostQuery{OrganizationID: "o1", Statuses: []string{"scheduled"}, ChannelIDs: []string{"c1"}, After: "cur0"})
	if err != nil {
		t.Fatal(err)
	}
	vars := jsonOf(got.Variables)
	for _, want := range []string{`"organizationId":"o1"`, `"status":["scheduled"]`, `"channelIds":["c1"]`, `"after":"cur0"`, `"direction":"asc","field":"dueAt"`} {
		if !strings.Contains(vars, want) {
			t.Errorf("variables %s missing %s", vars, want)
		}
	}
	if strings.Contains(got.Query, "o1") || strings.Contains(got.Query, "c1") {
		t.Error("user values spliced into the query")
	}
	if !page.More || page.Cursor != "cur1" || len(page.Posts) != 1 {
		t.Fatalf("page = %+v", page)
	}
	p := page.Posts[0]
	if p.Error != "token expired" || p.ErrorHelp != "https://help" || p.Author != "Ash" || len(p.Images) != 1 || p.Tags == nil || p.SentAt != "" {
		t.Errorf("post = %+v", p)
	}
}

func TestPostsSortsByStatus(t *testing.T) {
	for _, tc := range []struct {
		statuses []string
		want     string
	}{
		{[]string{"scheduled"}, `[{"direction":"asc","field":"dueAt"}]`},
		{[]string{"draft"}, `[{"direction":"desc","field":"createdAt"}]`},
		{[]string{"sent"}, `[{"direction":"desc","field":"dueAt"},{"direction":"desc","field":"createdAt"}]`},
	} {
		if got := jsonOf(postSort(tc.statuses)); got != tc.want {
			t.Errorf("%v: sort = %s, want %s", tc.statuses, got, tc.want)
		}
	}
}

func TestPostsRejectsUnknownStatus(t *testing.T) {
	c, _ := captureVars(t, `{}`)
	if _, err := c.Posts(context.Background(), PostQuery{OrganizationID: "o1", Statuses: []string{"buffer"}}); err == nil {
		t.Fatal("unknown status accepted")
	}
	if _, err := c.Posts(context.Background(), PostQuery{}); err == nil {
		t.Fatal("missing organization accepted")
	}
}

func TestDeletePost(t *testing.T) {
	c, got := captureVars(t, `{"data":{"deletePost":{"id":"p1"}}}`)
	if err := c.DeletePost(context.Background(), "p1"); err != nil {
		t.Fatal(err)
	}
	if jsonOf(got.Variables) != `{"input":{"id":"p1"}}` {
		t.Errorf("variables = %s", jsonOf(got.Variables))
	}

	c, _ = captureVars(t, `{"data":{"deletePost":{"message":"already sent"}}}`)
	if err := c.DeletePost(context.Background(), "p1"); err == nil || !strings.Contains(err.Error(), "already sent") {
		t.Fatalf("err = %v", err)
	}
}

func TestEditPost(t *testing.T) {
	c, got := captureVars(t, `{"data":{"editPost":{"post":{"id":"p1","text":"new","status":"scheduled"}}}}`)
	due := time.Now().Add(48 * time.Hour)
	p, err := c.EditPost(context.Background(), PostEdit{ID: "p1", Text: `new "text"`, DueAt: due})
	if err != nil {
		t.Fatal(err)
	}
	vars := jsonOf(got.Variables)
	for _, want := range []string{`"id":"p1"`, `"text":"new \"text\""`, `"mode":"customScheduled"`, `"dueAt":"` + due.UTC().Format("2006-01-02T15:04:05.000Z") + `"`} {
		if !strings.Contains(vars, want) {
			t.Errorf("variables %s missing %s", vars, want)
		}
	}
	if p.Text != "new" {
		t.Errorf("post = %+v", p)
	}

	// Text only leaves the schedule alone.
	c, got = captureVars(t, `{"data":{"editPost":{"post":{"id":"p1","text":"x"}}}}`)
	if _, err := c.EditPost(context.Background(), PostEdit{ID: "p1", Text: "x"}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(jsonOf(got.Variables), "mode") {
		t.Errorf("text edit changed the schedule: %s", jsonOf(got.Variables))
	}

	if _, err := c.EditPost(context.Background(), PostEdit{ID: "p1", Text: "x", DueAt: time.Now().Add(-time.Hour)}); err == nil {
		t.Error("past time accepted")
	}
	c, _ = captureVars(t, `{"data":{"editPost":{"message":"not allowed"}}}`)
	if _, err := c.EditPost(context.Background(), PostEdit{ID: "p1", Text: "x"}); err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("err = %v", err)
	}
}

func TestIdeasIncludesGroupsOnTheFirstPage(t *testing.T) {
	c, got := captureVars(t, `{"data":{"ideas":{"edges":[{"node":{"id":"i1","groupId":null,"createdAt":1762300000,
		"content":{"title":"T","text":"body","services":null}}}],"pageInfo":{"hasNextPage":false,"endCursor":null}},
		"ideaGroups":[{"id":"g1","name":"Next week","isLocked":false}]}}`)
	page, err := c.Ideas(context.Background(), "o1", "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got.Query, "ideaGroups") || got.Variables["org"] != "o1" {
		t.Errorf("first page skipped groups: %s %v", got.Query, got.Variables)
	}
	if len(page.Ideas) != 1 || page.Ideas[0].Title != "T" || page.Ideas[0].Services == nil || len(page.Groups) != 1 {
		t.Errorf("page = %+v", page)
	}

	c, got = captureVars(t, `{"data":{"ideas":{"edges":[],"pageInfo":{"hasNextPage":false}}}}`)
	if _, err := c.Ideas(context.Background(), "o1", "cur"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got.Query, "ideaGroups") || strings.Contains(got.Query, "$org") {
		t.Errorf("later page asked for groups: %s", got.Query)
	}
}

func TestCreateIdea(t *testing.T) {
	for name, reply := range map[string]string{
		"idea":     `{"data":{"createIdea":{"id":"i1","content":{"title":"T","text":"x"}}}}`,
		"response": `{"data":{"createIdea":{"idea":{"id":"i1","content":{"title":"T","text":"x"}},"refreshIdeas":true}}}`,
	} {
		c, got := captureVars(t, reply)
		idea, err := c.CreateIdea(context.Background(), NewIdea{OrganizationID: "o1", GroupID: "g1", Title: " T ", Text: "x"})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if idea.ID != "i1" || idea.Title != "T" {
			t.Errorf("%s: idea = %+v", name, idea)
		}
		vars := jsonOf(got.Variables)
		if !strings.Contains(vars, `"title":"T"`) || !strings.Contains(vars, `"group":{"groupId":"g1"}`) {
			t.Errorf("%s: variables = %s", name, vars)
		}
	}

	c, _ := captureVars(t, `{"data":{"createIdea":{"message":"limit reached"}}}`)
	if _, err := c.CreateIdea(context.Background(), NewIdea{OrganizationID: "o1", Text: "x"}); err == nil || !strings.Contains(err.Error(), "limit reached") {
		t.Fatalf("err = %v", err)
	}
	if _, err := c.CreateIdea(context.Background(), NewIdea{OrganizationID: "o1"}); err == nil {
		t.Error("empty idea accepted")
	}
}

func TestPost(t *testing.T) {
	c, got := captureVars(t, `{"data":{"post":{"id":"p1","text":"hi","status":"sent","channelId":"c1","externalLink":"https://linkedin.com/x"}}}`)
	p, found, err := c.Post(context.Background(), "p1")
	if err != nil || !found {
		t.Fatalf("found = %v, err = %v", found, err)
	}
	if p.Status != "sent" || p.ExternalLink != "https://linkedin.com/x" || jsonOf(got.Variables) != `{"input":{"id":"p1"}}` {
		t.Errorf("post = %+v, variables = %s", p, jsonOf(got.Variables))
	}

	c, _ = captureVars(t, `{"data":{"post":null}}`)
	if _, found, err := c.Post(context.Background(), "gone"); found || err != nil {
		t.Errorf("deleted post: found = %v, err = %v", found, err)
	}
	c, _ = captureVars(t, `{"errors":[{"message":"Post not found"}]}`)
	if _, found, err := c.Post(context.Background(), "gone"); found || err != nil {
		t.Errorf("not found error: found = %v, err = %v", found, err)
	}
}
