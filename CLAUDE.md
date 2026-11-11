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

## Releasing
- Never push a `v*` tag or create a GitHub release by hand. Releases come from CI.
- To release X.Y.Z: on a `release/X.Y.Z` branch, replace the old version with X.Y.Z in the 11 version files
  (`build/config.yml`, `build/darwin/Info.plist`, `Info.dev.plist`, `build/ios/Info.plist`, `Info.dev.plist`,
  `build/linux/nfpm/nfpm.yaml`, `build/windows/info.json`, `build/windows/msix/app_manifest.xml`, `template.xml`,
  `build/windows/nsis/wails_tools.nsh`, `build/windows/wails.exe.manifest`); `git grep` for the old version to check.
  Rename `## Unreleased` in `CHANGELOG.md` to `## X.Y.Z — YYYY-MM-DD` (and start a new empty Unreleased); `TestChangelogHasThisVersion` fails without it.
  Commit and title the PR exactly `Release X.Y.Z`, with nothing after the version, since a squash merge uses the PR title.
- When it merges, `.github/workflows/tag-release.yml` checks `build/config.yml` matches, tags the commit `vX.Y.Z` and
  starts `build.yml` on the tag, which publishes a pre-release with `SHA256SUMS` and rebuilds the site. A mismatched
  version fails the run without tagging. Installed copies are offered the update at their next launch.
- Builds stamp the commit and its date via `-ldflags -X main.buildCommit/buildCommitDate` (platform Taskfiles,
  `buildinfo.go`). Dev builds show the commit instead of the version (Dev mode tag, Settings, tray, Settings → About).
- `CHANGELOG.md` is built into the app (`changelog.go`): plain `- ` lines under version headings, user-facing, no markup.
  Release builds show the entries since `[updates] SEEN` once after an update (never on a fresh install) and list all of them
  in Settings → About. Add user-visible changes under Unreleased as you make them. `RELAY_WHATS_NEW=1 wails3 dev` previews the dialog.
- No risky changes or releases during judging (Nov 16–20, 2026) unless the user asks.

## Rules
- Plane is the source of truth; Relay writes changes back. Its only copy is an encrypted display
  cache (`plane-cache.json` in the app dir, last good sync, all projects) shown at launch;
  writes are refused (UI and Go) until the first live sync replaces it.
- Everything Relay writes to disk goes through `internal/vault` (AES-256-GCM, key in the OS keychain).
- Keychain access goes through `internal/keychain`, never go-keyring directly. On Linux with no Secret Service
  (WSL) it falls back to a 0600 plain file, `$XDG_DATA_HOME/relay/secrets.json`; only when the keychain is
  unreachable, never when it refuses. Settings → Storage shows the path while it's in use.
- Locked projects/modules (`[privacy] LOCKED`, empty by default; picked in Settings → Privacy) never reach the UI until unlocked via
  `internal/unlock` (Touch ID / login password); unlocks expire. Never log their data.
- Dev.to: send as `published: false`; publishing is a separate, confirmed user action, refused while image placeholders remain. No image upload in v1 (insert `<INSERT IMAGE HERE: …>` placeholders).
- Buffer: promotions need a live Dev.to article; Go adds its public link, so one can never go out without it. Posts written in the Buffer view (`BufferService.Compose`) aren't promotions: no article, no link. Articles reach a model provider only when the user asks.
  The Buffer tab's data is cached in `buffer-cache.json` (vault-encrypted, `buffercache.go`), shown first and refreshed; it's dropped on sign-out.
  `bufferwatch.go` checks for failed posts at launch and every 15 minutes and emits `buffer:failed` for ones not yet reported
  (IDs, channel and error only, never post text). Follow-up promotions are ordinary scheduled promotions, so Go adds the link to each.
  After a 429 the Buffer client refuses every call until Retry-After passes (`buffer.RateLimited`). The Timeline's post lists are
  cached in memory only (`buffercalendar.go`, 3 min) and dropped on any write through Relay; don't add per-click Buffer calls.
- Dev.to AI disclosure: `posts.Meta.AI` (none/assisted/generated, empty = none). Go appends the matching line when sending (`disclosure.go`)
  and strips it when pulling, so the local body never carries it.
- Ship log (`shiplogservice.go`): completed items in a window (Plane `completed_at`) plus `git log` subjects from a repo the
  user picks. Lockable projects/modules are always left out (unlocked or not); only titles and subjects reach the model,
  through `ai.Plane(PrivacyKeys…)`. Go re-reads the kept items by ID rather than trusting text from the UI.
- AI: every prompt goes through `ai.Client.Complete` with an `ai.Origin`. Plane content uses `ai.Plane(plane.PrivacyKeys(...))`;
  content from a lockable project or module only reaches a private provider: one the user marked (`[ai] PRIVATE`,
  tied to the endpoint), or Ollama / LM Studio at their default endpoints until turned off. A loopback address alone
  isn't trusted. Unlocking doesn't change that. Never log a refused prompt or the project it came from.
  Preload (`internal/ai/preload.go`, `[ai] PRELOAD`, on by default) warms a local Ollama / LM Studio model when the user is about to
  ask it (ship log opened, pointer or focus on an AI button: `preloadModel` / `preloadOnIntent`), never in the background. It sends no user content.
- UI state that's remembered per machine (last view and post, board view/filters/columns, sidebar width) lives in localStorage via
  `lib/prefs.ts`: IDs and choices only, and private projects' boards are remembered for the session only. The notification pane
  (`Toaster.tsx` `useInbox`) is in memory; errors are kept unless `keep: false`, which item-specific errors use so a relocked project isn't named.
- Planning in Buffer (`[planning] BUFFER`) is **experimental** in Relay because the upstream API is; keep it labelled so in the UI and docs. `internal/planning` maps Buffer content items (an Experimental Buffer API) to a
  board project (`buffer-plan`, source "buffer"); PlaneService routes its writes to `bufferplan.go`. Columns before
  posting are "Relay: …" tags; Scheduled/Published come from the item's posts and can't be dragged into. Card text stays in memory.
- Posts are local markdown files in the OS app-storage dir.
- Never commit `config.toml` or log secrets.
- Logs go through `internal/logs`: per-subsystem levels, in memory only. Never log locked project data, prompts, article text or terminal output.
- Terminal: no tmux dependency; shell integration is injected at spawn, never written into the user's dotfiles; the PTY WebSocket binds 127.0.0.1 only and requires the per-launch token.
