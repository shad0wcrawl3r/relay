package plane

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/config"
)

func TestRefDecodesIDOrObject(t *testing.T) {
	var it rawItem
	in := `{"state":{"id":"s1","name":"Todo"},"labels":["l1",{"id":"l2"}],"module":null}`
	if err := json.Unmarshal([]byte(in), &it); err != nil {
		t.Fatal(err)
	}
	if it.State != "s1" || len(it.Labels) != 2 || it.Labels[1] != "l2" || it.Module != "" {
		t.Errorf("got %+v", it)
	}
}

func TestListFollowsCursor(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Query().Get("cursor") == "" {
			fmt.Fprint(w, `{"results":[{"id":"a"}],"next_cursor":"100:1:0","next_page_results":true}`)
			return
		}
		fmt.Fprint(w, `{"results":[{"id":"b"}],"next_cursor":"100:2:0","next_page_results":false}`)
	}))
	defer srv.Close()
	config.Override(func(c *config.Config) { c.Plane.BaseURL = srv.URL })
	a := &auth{token: &Token{AccessToken: "tok", Workspace: "ws", Expiry: time.Now().Add(time.Hour)}}
	c := &client{auth: a, bucket: newBucket(10, time.Millisecond)}
	got, err := list[rawProject](context.Background(), c, "/projects/", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != "a" || got[1].ID != "b" {
		t.Errorf("got %+v", got)
	}
}
