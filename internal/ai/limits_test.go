package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

type fakeTransport func(*http.Request) (*http.Response, error)

func (f fakeTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func jsonResponse(r *http.Request, body string) *http.Response {
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}
}

func TestReplyCapIsSent(t *testing.T) {
	for id, field := range map[string]string{"ollama": "max_tokens", "openrouter": "max_tokens", "lmstudio": "max_tokens"} {
		_ = SetKey(id, "k")
		c := clientFor(t, id, func(w http.ResponseWriter, r *http.Request) {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body[field] != float64(replyTokens) || body["max_completion_tokens"] != nil {
				t.Errorf("%s: body = %v", id, body)
			}
			fmt.Fprint(w, `{"choices":[{"message":{"content":"hi"}}]}`)
		})
		if _, err := c.Complete(context.Background(), id, "m", "s", "u"); err != nil {
			t.Fatal(err)
		}
	}
}

func TestOpenAIGetsMaxCompletionTokens(t *testing.T) {
	_ = SetKey("openai", "k")
	c := New()
	// At its default endpoint OpenAI takes max_completion_tokens; the fake
	// transport answers instead of api.openai.com.
	c.http.Transport = fakeTransport(func(r *http.Request) (*http.Response, error) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["max_completion_tokens"] != float64(replyTokens) || body["max_tokens"] != nil {
			t.Errorf("body = %v", body)
		}
		return jsonResponse(r, `{"choices":[{"message":{"content":"hi"}}]}`), nil
	})
	if _, err := c.Complete(context.Background(), "openai", "m", "s", "u"); err != nil {
		t.Fatal(err)
	}
}

func TestCutShortInputIsAnError(t *testing.T) {
	article := strings.Repeat("word ", 4000) // ~5,000 tokens by the estimate
	c := clientFor(t, "ollama", func(w http.ResponseWriter, r *http.Request) {
		// What Ollama reports with its 2,048-token default context.
		fmt.Fprint(w, `{"choices":[{"message":{"content":"an off-topic plan"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2048,"completion_tokens":900}}`)
	})
	_, err := c.Complete(context.Background(), "ollama", "m", "s", article)
	if err == nil || !strings.Contains(err.Error(), "OLLAMA_CONTEXT_LENGTH") || !strings.Contains(err.Error(), "2048") {
		t.Fatalf("err = %v", err)
	}
	// Reading all of it is fine, and so is a short prompt with no usage.
	ok := clientFor(t, "ollama", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"choices":[{"message":{"content":"post"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4600}}`)
	})
	if _, err := ok.Complete(context.Background(), "ollama", "m", "s", article); err != nil {
		t.Fatal(err)
	}
	if cutShort(400, 100) || cutShort(5000, 0) || !cutShort(5000, 2048) || cutShort(5000, 2600) {
		t.Fatal("cutShort thresholds")
	}
}

func TestHittingTheLengthCapIsAnError(t *testing.T) {
	for id, body := range map[string]string{
		"ollama":    `{"choices":[{"message":{"content":"a very long plan"},"finish_reason":"length"}]}`,
		"anthropic": `{"content":[{"type":"text","text":"a very long plan"}],"stop_reason":"max_tokens"}`,
	} {
		_ = SetKey(id, "k")
		c := clientFor(t, id, func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) })
		if _, err := c.Complete(context.Background(), id, "m", "s", "u"); err == nil || !strings.Contains(err.Error(), "length limit") {
			t.Fatalf("%s: err = %v", id, err)
		}
	}
}

func TestSeriesIsRequiredInThePrompt(t *testing.T) {
	_, user := LinkedInPrompt(Article{Title: "T", Series: "Building Relay", Body: "b"})
	if !strings.Contains(user, `part of the series "Building Relay". Name the series in the post.`) {
		t.Fatalf("user = %q", user)
	}
	// The instruction comes after the fenced article, not inside it.
	if strings.Index(user, "Name the series") < strings.Index(user, "</article>") {
		t.Fatal("series instruction isn't after the article")
	}
	if _, plain := LinkedInPrompt(Article{Title: "T", Body: "b"}); strings.Contains(plain, "Name the series") {
		t.Fatal("series instruction without a series")
	}
}
