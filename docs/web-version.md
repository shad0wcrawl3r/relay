# Web version: investigated, shelved

**Status:** shelved on 2026-11-09. The code is doable, but testing a second runtime
(browser storage, WebAuthn unlock, a proxy, cross-browser quirks) on top of the desktop
app wasn't worth it. Read this before you pick the idea up again.

**Update 2026-11-20:** the server route was picked for the Android client instead: see
[`design/server.md`](../design/server.md) (per-user Cloudflare server for OAuth and proxying; data stays on the device).

The question was: how much effort would it take to run Relay in a browser with no
dedicated backend?

## Short answer

You can't do it with no backend at all, because the third-party APIs block browser
calls. With a thin serverless proxy it's a medium-sized port (about 2–4 weeks), and
most of that time goes into rewriting the Go logic in TypeScript and testing it.

## What makes it possible

- All Go calls from the UI go through one file, `frontend/src/lib/api.ts`. At the
  time of writing it covered 84 service methods, plus about 21 places that use Wails
  runtime events. A browser implementation could replace that file without touching
  the UI.

## What blocks it (checked 2026-11-09)

Before a cross-site request, a browser sends the API a CORS check (an `OPTIONS`
request). These are the replies we got when sending that check from
`Origin: https://example.com`:

| API | Result |
|---|---|
| Plane (`api.plane.so`) | No `Access-Control-Allow-Origin` header. The browser blocks the call. |
| Dev.to | `Access-Control-Allow-Origin: *`, but the `api-key` header isn't allowed. Authenticated writes are blocked. |
| Buffer (`api.buffer.com`) | The headers are allowed, but the origin isn't. Blocked for arbitrary origins. |

Plane OAuth also sends the client secret during the token exchange
(`internal/plane/oauth.go`, `SetBasicAuth`). A static site can't keep that secret.

To check again:

```sh
for u in https://api.plane.so/api/v1/users/me/ https://dev.to/api/articles/me https://api.buffer.com/; do
  echo "== $u"
  curl -s -o /dev/null -D - -X OPTIONS "$u" -H "Origin: https://example.com" \
    -H "Access-Control-Request-Method: GET" \
    -H "Access-Control-Request-Headers: x-api-key,api-key,authorization" | grep -iE "^HTTP|access-control"
done
```

## Each subsystem in a browser

| Subsystem | In a browser | Effort |
|---|---|---|
| Plane board + OAuth | Needs a proxy, plus a server-side secret for OAuth | Blocked without one |
| Dev.to publish | Needs a proxy for authenticated calls | Blocked without one |
| Buffer and Plan in Buffer | Needs a proxy | Blocked without one |
| Terminal | Browsers have no PTY. Drop it, or connect to a local agent | Not possible |
| Vault and keychain | WebCrypto AES-GCM with a non-extractable key in IndexedDB | Moderate |
| Unlock (Touch ID / password) | Re-check with a WebAuthn passkey. This is a weaker guarantee than the OS prompt | Moderate |
| Posts (local markdown) | IndexedDB, or the File System Access API (Chromium only) | Small |
| Settings and secrets | Encrypted in IndexedDB. API keys in browser storage are a security step down from the keychain | Small |
| AI | Ollama works if `OLLAMA_ORIGINS` is set. Anthropic allows direct browser calls with the `anthropic-dangerous-direct-browser-access` header. Other providers vary | Small to moderate |
| Logs, guide, drift, backup | Port the logic to TypeScript | Small |

The biggest risk is that about 8k lines of Go would become TypeScript, including the
privacy routing: `ai.Origin`, the private-provider rules and locked projects. Those
rules from CLAUDE.md would need to be rebuilt and retested from scratch.

## Options

1. **A thin serverless proxy, such as a Cloudflare Worker (the best fit for a hosted
   version).** It handles CORS for Plane, Dev.to and Buffer, holds the Plane client
   secret for the OAuth exchange, and passes everything else through without storing
   anything. That's about 100–200 lines. Everything else runs in the browser, except
   the terminal. About 2–4 weeks.
2. **Compile the Go to WebAssembly (`GOOS=js`) and keep `internal/` mostly as is.**
   This avoids most of the rewrite. You still need the proxy, and the keychain, file
   and PTY code still has to be replaced. Expect a large bundle and awkward debugging.
3. **Serve the existing Go app over HTTP on your own machine and open it in a
   browser.** Technically this is a backend, but it keeps every feature, including the
   terminal. A few days of work. This is the best option if the goal is "use Relay
   from a browser" rather than "host it for other people".
