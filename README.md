# Relay

A desktop workbench for building in public. Plan work on a Plane kanban, write
the post in a markdown editor, send it to Dev.to as a draft, and promote it
through Buffer. A terminal is built in.

Built with Go and [Wails v3](https://v3.wails.io/), with a React and TypeScript
frontend. Runs on macOS, Windows and Linux.

## Features

### Done

- **Plane** (optional: Relay works with just Buffer)
  - Attention home: an inbox across all your projects
  - Kanban board with drag and drop, filters and search
  - Module lanes view
  - Item drawer with comments and activity
  - Quick capture palette (⌘K)
  - Connects through a Plane app installation (OAuth)
  - Encrypted cache of the last sync, read-only until the first live sync
- **Writing**
  - Markdown editor with preview and image placeholders
  - Sends to Dev.to as an unpublished draft, and syncs your articles back
  - Publishing is a separate, confirmed step
- **Promotion**
  - Buffer sign-in with OAuth, with tokens kept in the OS keychain
  - Turns a Dev.to post into social drafts per channel. AI summaries are optional
  - Review and edit each draft before it goes to Buffer
  - Every post carries the article's public link
  - Buffer tab: channels with posting schedules and weekly goals; the queue,
    drafts, approvals, sent and failed posts; edit, reschedule and delete;
    ideas, drafted with AI from any pasted text
  - AI providers: Anthropic, OpenAI, OpenRouter, Ollama and LM Studio, with
    custom endpoints and model search
- **Terminal**
  - Background sessions owned by Go, with detach and reattach
  - Panes, tabs, splits and zoom, with tmux-style keybindings
  - Quick terminal (⌘/) over any view
- **Privacy and app**
  - Everything written to disk is encrypted (AES-256-GCM), with the key in the
    OS keychain
  - Lock projects behind Touch ID. Unlocks expire
  - Per-subsystem logs, held in memory only
  - Runs in the background with a tray icon
  - CI builds for macOS, Windows and Linux

### Planned

For the Buffer Commit contest:

- First-run onboarding
- Stop "Update draft" from overwriting edits made on Dev.to
- Move secrets out of `config.toml` into the keychain
- Keep locked project data away from cloud AI providers
- Ship log: turn finished Plane work into Buffer drafts
- Public releases, with steps for opening unsigned builds
- `relay` CLI and MCP server

Later:

- Shell integration and Warp-style command blocks
- Session switcher, plus block actions (copy, re-run, save, find, pin)
- Git: a changes panel, a diff viewer and code review
- Command palette for commands, files and workspaces
- More promotion channels, plus threads for X, Threads and Bluesky
- Image upload for Dev.to and Buffer
- Unlock on Windows and Linux
- Auto-update

## Getting started

Requires Go (the version in `go.mod`), Node 22, and the
[Wails v3 CLI](https://v3.wails.io/getting-started/installation/).

```sh
wails3 dev     # run with hot reload
wails3 build   # production build in bin/
```

Settings live in `config.toml` in the project root. Environment variables with
the `RELAY_` prefix override it. Most settings can be changed from the app's
Settings screen.

```toml
[devto]
API_KEY = ""          # dev.to → Settings → Extensions

[plane]
BASE_URL = "https://api.plane.so"
CLIENT_ID = ""        # from your Plane app; the Settings screen has a guide
CLIENT_SECRET = ""
```

Never commit `config.toml`. It is already in `.gitignore`.

## Layout

| Path | What's there |
| --- | --- |
| `main.go`, `*service.go` | Wails app and the services bound to the frontend |
| `internal/` | `plane`, `devto`, `buffer`, `ai`, `posts`, `term`, `vault`, `unlock`, `logs`, `config` |
| `frontend/` | React and TypeScript UI |
| `design/` | UI spec (`design/README.md`) and reference mockups |
| `Project.md` | Intent and Dev.to API notes |
