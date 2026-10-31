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

func capture(t *testing.T, reply string) (*Client, *string) {
	t.Helper()
	var got string
	c := newClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		got = body.Query
		fmt.Fprint(w, reply)
	})
	seed(t, c, Token{AccessToken: "ok", Expiry: time.Now().Add(time.Hour)})
	return c, &got
}

const created = `{"data":{"createPost":{"post":{"id":"p1"}}}}`

func TestCreatePostModes(t *testing.T) {
	due := time.Date(2099, 3, 10, 15, 0, 0, 0, time.FixedZone("NPT", 5*3600+45*60))
	for name, tc := range map[string]struct {
		post NewPost
		want []string
		not  []string
	}{
		"queue":    {NewPost{Timing: Queue}, []string{"mode: addToQueue"}, []string{"saveToDraft", "dueAt"}},
		"draft":    {NewPost{Timing: Draft}, []string{"mode: addToQueue", "saveToDraft: true"}, []string{"dueAt"}},
		"schedule": {NewPost{Timing: Schedule, DueAt: due}, []string{"mode: customScheduled", `dueAt: "2099-03-10T09:15:00.000Z"`}, []string{"saveToDraft"}},
	} {
		t.Run(name, func(t *testing.T) {
			c, q := capture(t, created)
			tc.post.ChannelID, tc.post.Text = "ch1", "hello"
			id, err := c.CreatePost(context.Background(), tc.post)
			if err != nil || id != "p1" {
				t.Fatalf("got %q, %v", id, err)
			}
			for _, s := range append(tc.want, `channelId: "ch1"`, "schedulingType: automatic", "MutationError") {
				if !strings.Contains(*q, s) {
					t.Errorf("missing %q in %s", s, *q)
				}
			}
			for _, s := range tc.not {
				if strings.Contains(*q, s) {
					t.Errorf("unexpected %q in %s", s, *q)
				}
			}
		})
	}
}

func TestCreatePostEscapesText(t *testing.T) {
	c, q := capture(t, created)
	text := "line one\n\n\"quoted\" \\ back } mutation"
	if _, err := c.CreatePost(context.Background(), NewPost{ChannelID: "c", Text: text, Timing: Queue}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(*q, `text: "line one\n\n\"quoted\" \\ back } mutation"`) {
		t.Errorf("query = %s", *q)
	}
}

func TestCreatePostReportsAMutationError(t *testing.T) {
	c, _ := capture(t, `{"data":{"createPost":{"message":"queue is full"}}}`)
	_, err := c.CreatePost(context.Background(), NewPost{ChannelID: "c", Text: "t", Timing: Queue})
	if err == nil || !strings.Contains(err.Error(), "queue is full") {
		t.Fatalf("err = %v", err)
	}
}

func TestCreatePostValidates(t *testing.T) {
	c, q := capture(t, created)
	for name, p := range map[string]NewPost{
		"no channel": {Text: "t", Timing: Queue},
		"empty":      {ChannelID: "c", Text: "  \n", Timing: Queue},
		"past":       {ChannelID: "c", Text: "t", Timing: Schedule, DueAt: time.Now().Add(-time.Hour)},
		"no time":    {ChannelID: "c", Text: "t", Timing: Schedule},
		"bad timing": {ChannelID: "c", Text: "t", Timing: "now"},
	} {
		if _, err := c.CreatePost(context.Background(), p); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	if *q != "" {
		t.Errorf("sent a request: %s", *q)
	}
}

func TestChannelsSpanOrganizations(t *testing.T) {
	calls := 0
	c := newClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.Contains(body.Query, "account") {
			fmt.Fprint(w, `{"data":{"account":{"organizations":[{"id":"o1"},{"id":"o2"}]}}}`)
			return
		}
		calls++
		fmt.Fprintf(w, `{"data":{"channels":[{"id":"c%d","name":"N","service":"linkedin"}]}}`, calls)
	})
	seed(t, c, Token{AccessToken: "ok", Expiry: time.Now().Add(time.Hour)})
	got, err := c.Channels(context.Background())
	if err != nil || len(got) != 2 || got[1].ID != "c2" || got[0].Service != "linkedin" {
		t.Fatalf("got %+v, %v", got, err)
	}
}
