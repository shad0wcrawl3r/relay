# Relay

Wails3 desktop workbench: a custom Plane (app.plane.so) kanban frontend via
Plane OAuth + a Dev.to markdown editor/publisher + an embedded tmux-like
terminal (Go-owned background sessions, in-app splits, Warp-style blocks).

## Read first
- `design/README.md` — full UI spec, behaviour decisions, design tokens, open questions.
- `design/kanban/*.dc.html`, `design/editor/*.dc.html`, `design/terminal/*.dc.html` — reference mockups
  (design-canvas format, not runnable; sample data lives in each file's
  `renderVals()`). Rebuild them, don't import them.
- `Project.md` — intent + Dev.to article API reference.

## Stack
- Backend: Go, Wails v3 (`github.com/wailsapp/wails/v3`), module `github.com/shad0wcrawl3r/relay`.
  Config via viper from `config.toml` (`[plane] BASE_URL/CLIENT_ID`, …), env prefix `RELAY`.
  Secrets (Dev.to key, Plane client secret) live in the OS keychain (`internal/config/secrets.go`), never in the file.
  Packages under `internal/`: `ai`, `backup`, `buffer`, `config`, `devto`, `logs`, `plane` (OAuth app-installation
  flow, API client, locks), `posts`, `term`, `unlock`, `vault`. Wails services live in the root package (`*service.go`).
- Frontend: `frontend/` — React 18 + TS + Vite, Tailwind v4 + shadcn/ui (zinc, dark).
- Build/run: `wails3 dev`, `wails3 build` (Taskfile).

## Rules
- Plane is the source of truth; Relay writes changes back. Its only copy is an encrypted display
  cache (`plane-cache.json` in the app dir, last good sync, all projects) shown at launch;
  writes are refused (UI and Go) until the first live sync replaces it.
- Everything Relay writes to disk goes through `internal/vault` (AES-256-GCM, key in the OS keychain).
- Locked projects/modules (`[privacy] LOCKED`, default TEACH) never reach the UI until unlocked via
  `internal/unlock` (Touch ID / login password); unlocks expire. Never log their data.
- Dev.to: send as `published: false`; publishing is a separate, confirmed user action, refused while image placeholders remain. No image upload in v1 (insert `<INSERT IMAGE HERE: …>` placeholders).
- Buffer: promotions need a live Dev.to article; Go adds its public link, so one can never go out without it. Articles reach a model provider only when the user asks.
- AI: every prompt goes through `ai.Client.Complete` with an `ai.Origin`. Plane content uses `ai.Plane(plane.PrivacyKeys(...))`;
  content from a lockable project or module only reaches a private provider: one the user marked (`[ai] PRIVATE`,
  tied to the endpoint), or Ollama / LM Studio at their default endpoints until turned off. A loopback address alone
  isn't trusted. Unlocking doesn't change that. Never log a refused prompt or the project it came from.
- Posts are local markdown files in the OS app-storage dir.
- Never commit `config.toml` or log secrets.
- Logs go through `internal/logs`: per-subsystem levels, in memory only. Never log locked project data, prompts, article text or terminal output.
- Terminal: no tmux dependency; shell integration is injected at spawn, never written into the user's dotfiles; the PTY WebSocket binds 127.0.0.1 only and requires the per-launch token.
