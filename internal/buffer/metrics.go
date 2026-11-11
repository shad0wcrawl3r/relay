package buffer

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Post metrics. Buffer fills them for sent posts once a day; a metric
// missing from the list wasn't reported, which isn't the same as zero.
// Buffer's guide says only a personal API key can read them (the
// insightsRead scope isn't offered to OAuth apps), so PostMetrics tries the
// OAuth token first and reports ErrNoInsights when Buffer refuses it.

type Metric struct {
	Type  string  `json:"type"`
	Name  string  `json:"name"`
	Value float64 `json:"value"`
	// Unit is "count" or "percentage".
	Unit string `json:"unit"`
}

type PostMetrics struct {
	Metrics   []Metric   `json:"metrics"`
	UpdatedAt *time.Time `json:"updatedAt"`
	// Found is false when Buffer has no post with that ID any more.
	Found bool `json:"found"`
}

// ErrNoInsights means Buffer won't show metrics to this sign-in.
var ErrNoInsights = errors.New("Buffer doesn't share post metrics with this sign-in")

// PostMetrics reads the metrics of up to 50 posts in one request. key is a
// personal API key; empty uses the OAuth sign-in.
func (c *Client) PostMetrics(ctx context.Context, key string, ids []string) (map[string]PostMetrics, error) {
	if len(ids) > 50 {
		ids = ids[:50]
	}
	out := map[string]PostMetrics{}
	if len(ids) == 0 {
		return out, nil
	}
	var q strings.Builder
	vars := map[string]any{}
	q.WriteString("query Metrics(")
	for i := range ids {
		if i > 0 {
			q.WriteString(", ")
		}
		fmt.Fprintf(&q, "$in%d: PostInput!", i)
	}
	q.WriteString(") {")
	for i, id := range ids {
		fmt.Fprintf(&q, " p%d: post(input: $in%d) { id metrics { type name value unit } metricsUpdatedAt }", i, i)
		vars[fmt.Sprintf("in%d", i)] = map[string]string{"id": id}
	}
	q.WriteString(" }")

	type row struct {
		ID               string     `json:"id"`
		Metrics          []Metric   `json:"metrics"`
		MetricsUpdatedAt *time.Time `json:"metricsUpdatedAt"`
	}
	data := map[string]*row{}
	var err error
	if key != "" {
		err = c.queryWithKey(ctx, key, q.String(), vars, &data)
	} else {
		err = c.queryVars(ctx, q.String(), vars, &data)
	}
	if err != nil {
		if key == "" && refusedInsights(err) {
			return nil, ErrNoInsights
		}
		return nil, err
	}
	for i, id := range ids {
		r := data[fmt.Sprintf("p%d", i)]
		if r == nil {
			out[id] = PostMetrics{}
			continue
		}
		out[id] = PostMetrics{Metrics: r.Metrics, UpdatedAt: r.MetricsUpdatedAt, Found: true}
	}
	return out, nil
}

// refusedInsights guesses whether an error is Buffer withholding metrics
// from this sign-in, rather than a network or query problem.
func refusedInsights(err error) bool {
	var limited *RateLimited
	if errors.As(err, &limited) || errors.Is(err, ErrNotConnected) {
		return false
	}
	m := strings.ToLower(err.Error())
	for _, w := range []string{"scope", "insight", "permission", "forbidden", "not authorized", "unauthorized", "access", "http 403"} {
		if strings.Contains(m, w) {
			return true
		}
	}
	return false
}

// CheckKey confirms Buffer accepts a personal API key.
func (c *Client) CheckKey(ctx context.Context, key string) error {
	var data struct {
		Account struct {
			Name string `json:"name"`
		} `json:"account"`
	}
	return c.queryWithKey(ctx, key, `query { account { name } }`, nil, &data)
}
