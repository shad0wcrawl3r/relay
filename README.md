# Relay

A desktop workbench for building in public. Plan work on a Plane kanban, write
the post in a markdown editor, send it to Dev.to as a draft, and promote it
through Buffer. A terminal is built in.

Built with Go and [Wails v3](https://v3.wails.io/), with a React and TypeScript
frontend. Runs on macOS, Windows and Linux.

**Download:** [relay.shadowcrawler.dev](https://relay.shadowcrawler.dev)

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
  - Spots edits made on Dev.to: Update draft shows a diff (unified or side by
    side) and asks whether to keep Dev.to's version or replace it
- **Promotion**
  - Buffer sign-in with OAuth, with tokens kept in the OS keychain
  - Turns a Dev.to post into social drafts per channel. AI summaries are optional
  - Review and edit each draft before it goes to Buffer
  - Every post carries the article's public link
  - Buffer tab: channels with posting schedules and weekly goals; the queue,
    drafts, approvals, sent and failed posts; edit, reschedule and delete;
    ideas, drafted with AI from any pasted text
  - Buffer column on Plane boards: drag work items in to save them as Buffer
    ideas, or drag ideas out to make work items (never for private projects)
  - AI providers: Anthropic, OpenAI, OpenRouter, Ollama and LM Studio, with
    custom endpoints and model search
- **Terminal**
  - Background sessions owned by Go, with detach and reattach
  - Panes, tabs, splits and zoom, with tmux-style keybindings
  - Quick terminal (⌘/) over any view
  - ⌘T opens a tab; `exit` closes the pane, or the tab if it was the last one
- **Privacy and app**
  - Setup guide: a small window that floats over the browser and walks through
    Buffer, an AI provider, Dev.to and Plane, one step at a time. Opens on first
    run; Settings → Run setup guide brings it back
  - API keys and client secrets live in the OS keychain, never in `config.toml`
  - Everything written to disk is encrypted (AES-256-GCM), with the key in the
    OS keychain
  - Lock projects behind Touch ID. Unlocks expire
  - Private projects never reach a cloud model: only local providers, or ones
    you mark private in Settings → AI, can read them, even while unlocked
  - Per-subsystem logs, held in memory only
  - Runs in the background with a tray icon
  - CI builds for macOS, Windows and Linux

### Planned

For the Buffer Commit contest:

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

On first run the setup guide opens. Settings live in `config.toml` in the
project root (or the OS app-config dir); secrets (the Dev.to key and the Plane
client secret) are kept in the OS keychain instead, and any found in an older
`config.toml` are moved there at launch. Environment variables with the
`RELAY_` prefix override both (`RELAY_DEVTO_API_KEY`,
`RELAY_PLANE_CLIENT_SECRET`) and are never copied into the keychain or file.

```toml
[plane]
BASE_URL = "https://api.plane.so"
CLIENT_ID = ""        # from your Plane app; the setup guide walks through it
```

Never commit `config.toml`. It is already in `.gitignore`.

## Layout

| Path | What's there |
| --- | --- |
| `main.go`, `*service.go` | Wails app and the services bound to the frontend |
| `internal/` | `plane`, `devto`, `buffer`, `ai`, `posts`, `term`, `vault`, `unlock`, `logs`, `config` |
| `frontend/` | React and TypeScript UI |
| `site/` | [relay.shadowcrawler.dev](https://relay.shadowcrawler.dev): landing page, downloads, status and the Buffer sign-in callback (`site/public`, tests in `site/test`), published by `.github/workflows/pages.yml` |
| `design/` | UI spec (`design/README.md`) and reference mockups |
| `Project.md` | Intent and Dev.to API notes |

## License

[BSD 3-Clause](LICENSE).
