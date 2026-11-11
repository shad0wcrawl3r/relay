# Relay threat model

Relay is a desktop app that holds the keys to a person's public voice. It
signs in to Plane, Dev.to and Buffer, can publish articles and schedule social
posts, runs a shell, and can send text to AI providers. This document says
what Relay protects, where the trust boundaries are, what could go wrong, and
what the code does about each threat. It names files so each claim can be
checked.

It was written for Relay 0.0.9 (November 2026). Report anything that doesn't
hold as described in [SECURITY.md](../SECURITY.md).

## What Relay protects

| Asset | Why it matters |
|---|---|
| Tokens and keys: Plane app secret and bot token, Buffer OAuth tokens, Dev.to API key | Anyone holding them can read private work, publish as the user or post to their social accounts. |
| Private project content (projects or modules the user locked) | Client or employer work that must not leak to the screen, the logs, or an AI provider. |
| Drafts and article text | Unpublished writing. |
| The user's public accounts | A wrong publish or promotion is public within seconds and can't always be taken back (Dev.to's API can't delete an article). |
| The machine | Relay runs a shell; whoever can drive it can run commands. |

## Trust boundaries

1. **Relay's Go process.** Owns every secret, every network call and every
   file. The source of truth for what may happen.
2. **The webview (React UI).** Shows data and asks Go to act. Go treats what
   it sends as requests, not facts.
3. **Other local processes and web pages in the user's browser.** They can
   reach anything listening on 127.0.0.1.
4. **The services:** Plane, Dev.to (Forem), Buffer, and Relay's own site
   relay.shadowcrawler.dev, which hosts the OAuth callback page.
5. **AI providers:** local (Ollama, LM Studio) or remote.
6. **The release pipeline:** GitHub Actions, which builds and publishes every
   installer.

## Threats and how Relay handles them

### Secrets at rest

**Threat:** tokens copied from a config file, a backup or a synced folder.

- Secrets live only in the OS keychain, through one package
  (`internal/keychain`). `config.toml` never holds them, and Settings never
  shows them again after they are saved.
- Everything Relay writes to disk (posts, caches, backups) goes through
  `internal/vault`: AES-256-GCM with a random nonce per write, under a key
  that exists only in the keychain. A copied app folder is unreadable on
  another machine.
- On Linux without a Secret Service (WSL), Relay falls back to a 0600 file,
  and only when the keychain can't be reached, never when it refuses. Settings
  shows the path while that fallback is in use.

### Signing in: the OAuth callback

**Threat:** a stolen authorization code, a forged redirect, or a local
process racing the real redirect.

Buffer allows one fixed https redirect URI, but Relay listens on a random
loopback port. The flow (`internal/buffer/oauth.go`,
`site/public/oauth/forward.js`):

- Authorization Code with **PKCE (S256)**. The verifier never leaves the Go
  process, so a code caught anywhere on the way is useless on its own.
- Buffer redirects to `relay.shadowcrawler.dev/oauth/callback`. That static
  page reads the port from the state (`<port>.<nonce>`), checks it against a
  strict pattern and a 1024–65535 range, and forwards **only to
  `http://127.0.0.1:<port>`**, with only `code`, `state`, `error` and
  `error_description`. It refuses to run inside a frame and removes the code
  from the address bar and history before leaving.
- The listener binds 127.0.0.1 only, compares the state in constant time, and
  ignores any request with the wrong state while it keeps waiting for the real
  one. It times out and allows one sign-in at a time.

### Private projects

**Threat:** locked work shown to someone looking at the screen, written to
logs, or sent to a cloud model.

- Locked projects and modules don't reach the UI until the user unlocks them
  with Touch ID or the login password (`internal/unlock`). Unlocks expire.
- Logs (`internal/logs`) stay in memory and never carry locked project data,
  prompts, article text or terminal output.
- Remembered UI state stores IDs and choices only. Private boards are
  remembered for the session only.
- The notification pane leaves item names out of errors that could name a
  project that has since been locked again.

### AI providers

**Threat:** private content sent to a provider the user didn't choose for it,
or text from the UI used to smuggle content into a prompt.

- Every prompt goes through one function, `ai.Client.Complete`, tagged with
  where its content came from (`ai.Origin`).
- Content from a lockable project only goes to a **private** provider: one the
  user marked as private (tied to its exact endpoint), or Ollama or LM Studio
  at their default endpoints. **A loopback address alone isn't trusted**,
  because any local port can forward to the internet. Unlocking a project
  doesn't change where its content may go.
- Refused prompts aren't logged, and the refusal doesn't name the project.
- The ship log re-reads the items it uses by ID in Go instead of trusting
  titles sent by the UI, and leaves lockable projects out entirely.
- Warming a local model ("preload") sends no user content.

### Publishing and promotion

**Threat:** a bug, a replayed click or a compromised UI publishes something
unintended, or promotes an article that isn't live.

- Articles are sent to Dev.to as unpublished drafts. Publishing and
  unpublishing are separate, confirmed actions, and publishing is refused while
  image placeholders remain.
- Before an update, Relay checks whether the Dev.to copy changed since it last
  saw it, and stops rather than overwrite edits made there.
- A Buffer promotion needs a live Dev.to article, and **Go adds the article's
  link**. The UI can't produce a promotion without it, or with a different one.
- After a 429, the Buffer client refuses every call until Retry-After passes,
  so a bug can't hammer Buffer or get the user's account rate-limited further.
- Deleting an article (which the Dev.to API can't do) unpublishes it first, can
  remove its pending promotions, and then hands the final step to Dev.to's own
  confirmation page.

### The terminal

**Threat:** a web page or another local user drives Relay's shell.

- The PTY server binds 127.0.0.1 only and requires a random per-launch token,
  compared in constant time (`internal/term/server.go`). A web page can reach
  the port but can't learn the token.
- Shell integration is injected when a session starts. Relay never edits the
  user's dotfiles.
- **Known gap:** the WebSocket accept skips the Origin check
  (`InsecureSkipVerify`). The token is the only gate today; checking the
  webview's origin as well would add a second one. Tracked as a follow-up.

### Data cached from services

**Threat:** stale or forged data used to make changes.

- Plane's cached copy (`plane-cache.json`, encrypted) is for display only.
  Writes are refused, in the UI and in Go, until the first live sync replaces
  it.
- Buffer's cache is encrypted and dropped on sign-out.

### Release and supply chain

**Threat:** a tampered installer, or a release pushed by hand.

- No one tags or publishes releases by hand. A release PR that changes the
  version merges, CI checks the version, tags the commit and builds it.
- Every pull request must pass macOS, Windows and Linux builds before it can
  merge. Releases ship with `SHA256SUMS`.
- CI runs govulncheck, gitleaks, CodeQL (Go and TypeScript) and dependency
  review on every pull request. Dependabot watches Go modules, npm packages and
  GitHub Actions.
- Builds are not code-signed yet. The download page documents how to open them.
  Signed build provenance and an SBOM are planned.

## Out of scope

- A machine that's already compromised. Malware running as the user can read
  the keychain items the user can read, and can drive the app like the user can.
- The services themselves (Plane, Dev.to, Buffer, AI providers) and what they
  do with data the user chose to send them.
- Someone with the user's unlocked session and login password.

## Follow-ups

- Check the webview's Origin on the terminal WebSocket, in addition to the token.
- Fuzz the parsers that read outside input: OAuth state, disclosure lines, the
  changelog, service responses.
- Signed build provenance and an SBOM for each release.
- Code signing on macOS and Windows.
