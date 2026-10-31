package plane

import (
	"log"
	"net/http"
	"net/http/httputil"
	"os"
	"strings"
	"time"

	"github.com/shad0wcrawl3r/relay/internal/logs"
)

// Temporary OAuth debugging. With RELAY_DEBUG_HTTP=1, /auth/o/ requests and
// responses are dumped in full, client secret and tokens included, so only
// enable it with credentials you are about to rotate. API calls log only
// method, URL and status: their bodies carry project data (Teaching) that must
// never reach logs.
func debugHTTP() bool { return os.Getenv("RELAY_DEBUG_HTTP") != "" }

func transport() http.RoundTripper {
	if !debugHTTP() {
		return logs.Transport("plane", nil)
	}
	log.Println("plane: RELAY_DEBUG_HTTP is set; OAuth traffic is logged in full, including secrets")
	return logs.Transport("plane", debugTransport{http.DefaultTransport})
}

type debugTransport struct{ next http.RoundTripper }

func (d debugTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	full := strings.Contains(req.URL.Path, "/auth/o/")
	if full {
		if b, err := httputil.DumpRequestOut(req, true); err == nil {
			log.Printf("plane >>> request\n%s\n", b)
		}
	}
	start := time.Now()
	resp, err := d.next.RoundTrip(req)
	if err != nil {
		log.Printf("plane <<< %s %s: %v", req.Method, req.URL, err)
		return nil, err
	}
	if full {
		if b, err := httputil.DumpResponse(resp, true); err == nil {
			log.Printf("plane <<< response (%s)\n%s\n", time.Since(start).Round(time.Millisecond), b)
		}
	} else {
		log.Printf("plane %s %s -> %s (%s)", req.Method, req.URL, resp.Status, time.Since(start).Round(time.Millisecond))
	}
	return resp, nil
}
