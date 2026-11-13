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
  - Item drawer with comments and activity. Checklists in a description
    show as checkboxes; ticking one saves to Plane
  - Linked posts: an item shows the posts written about it and where each one
    is (draft, published, promoted)
  - Attention's "Ready to write about" lists what you finished this week that
    no post covers yet, with a button to open Ship on it. J and K move
    through Attention; Enter opens, D, S and A run Done, Send back and Approve
  - Moves on a board or from Attention can be undone from the toast
  - Quick capture palette (⌘K)
  - Zoom every view with ⌘ + / ⌘ - and reset with ⌘ 0 (Ctrl on Windows and
    Linux); the level is remembered
  - Your own project order, colours and quick capture project (Settings →
    Plane → Projects). Projects with an Idea state capture new work as ideas
  - Connects through a Plane app installation (OAuth)
  - Encrypted cache of the last sync, read-only until the first live sync
- **Writing**
  - Markdown editor with preview and image placeholders
  - Sends to Dev.to as an unpublished draft, and syncs your articles back
  - Publishing is a separate, confirmed step
  - AI use per post (none, assisted or generated), sent as Dev.to's own AI
    marker. Articles that carried the older disclosure line lose it the next
    time they're sent
  - A status strip shows where a post is: local, draft on Dev.to, published or
    promoted
  - Link a post to the Plane items it's about
  - Unpublish an article on Dev.to, or delete it (Relay unpublishes it, then
    opens Dev.to's delete page, since the API can't delete). Either can also
    remove the article's promotions that haven't gone out yet. An article
    deleted on Dev.to is noticed and can be kept as a local draft
  - Delete a draft that hasn't gone to Dev.to yet from the editor's footer,
    with Undo
  - Insights: a published article's Dev.to views, reactions and comments, and
    how each promotion did on Buffer (impressions, reactions, clicks, LinkedIn
    included). Buffer's metrics need an optional personal API key
  - Ship (the ship icon above the post list): pick a date range, the
    projects and optionally a git repository; Relay lists the items finished
    in that range and the commit subjects, you untick what stays out and add
    notes, and the AI model drafts a post that opens as a new, AI-assisted
    draft (or a Buffer post). The draft links the items it used. Writing from
    Buffer-board items is not implemented yet.
    Private projects and modules never take part, and only item titles and
    commit subjects reach the model
  - Spots edits made on Dev.to: Update draft shows a diff (unified or side by
    side) and asks whether to keep Dev.to's version or replace it
- **Promotion**
  - Buffer sign-in with OAuth, with tokens kept in the OS keychain
  - Turns a Dev.to post into social drafts per channel. AI summaries are optional
  - Review and edit each draft before it goes to Buffer
  - Every post carries the article's public link, with a preview of each post
    before it goes out
  - Optional follow-up posts three days and a week later, each with the link
  - Or write a post straight for Buffer, no article needed: one text to one or
    more channels (or from an idea), queued, scheduled or saved as a draft.
    AI can draft it from rough notes to fit the strictest channel, and the
    review shows a preview per channel
  - "Promoted once" on an article lists its Buffer posts with their status,
    linking to the post in the Buffer tab and on the network once it's out
  - The Buffer tab opens on its last data (an encrypted cache, like Plane's)
    and refreshes in the background
  - Buffer tab: channels with posting schedules and weekly goals; the queue,
    drafts, approvals, sent and failed posts, read as a schedule grouped by
    day. Edit text in place, reschedule from a menu or by dragging onto
    another day (with Undo), delete, copy, search, and Retry failed posts.
    Ideas, drafted with AI from any pasted text; Write an article turns an
    idea into a new post
  - Relay tells you when Buffer couldn't publish a post, at launch and every
    15 minutes. After a rate limit it waits instead of asking again
  - Timeline: a daily and weekly view of Buffer posts, Dev.to articles, Plane
    items due and cycle dates
  - Plan in Buffer (**experimental**, because Buffer's content item API is): a board of Buffer content items, with or
    without Plane. Idea, Todo, In Progress and Ready are Buffer tags Relay
    adds ("Relay: …"); cards with posts follow them to Scheduled and Published
  - Buffer column on Plane boards: drag work items in to save them as Buffer
    ideas, or drag ideas out to make work items (never for private projects)
  - Custom prompts: Settings → AI → Prompts rewrites the instructions for
    each AI action (promoting an article, a post from notes, Ship's article
    and Buffer post), with a reset to Relay's own
  - AI providers: Anthropic, OpenAI, OpenRouter, Ollama and LM Studio, with
    custom endpoints, model search and a test before saving. Ollama and LM
    Studio models can load into memory when you open Ship or point at
    an AI button (Settings → AI → Preload); nothing loads in the background
- **Terminal**
  - Background sessions owned by Go, with detach and reattach
  - Panes, tabs, splits and zoom, with tmux-style keybindings
  - Quick terminal (⌘/) over any view
  - ⌘T opens a tab; `exit` closes the pane, or the tab if it was the last one
  - Pick from the shells installed on the machine: `/etc/shells` on macOS and
    Linux; PowerShell, Command Prompt, Git Bash and WSL on Windows
- **Privacy and app**
  - Settings sections down the left, with dots showing whether Plane, Dev.to
    and Buffer are connected
  - Setup guide: a small window that floats over the browser and walks through
    Buffer, an AI provider, Dev.to, Plane and the terminal shell, one step at a
    time. Opens on first run; Settings → Run setup guide brings it back
  - Move to another computer: export settings and API keys to a file locked
    with six words (Argon2id + AES-256-GCM, fully offline), then import it
    there. The same settings always get the same words
  - API keys and client secrets live in the OS keychain, never in `config.toml`
  - Everything written to disk is encrypted (AES-256-GCM), with the key in the
    OS keychain
  - Linux without a keychain (no Secret Service, e.g. WSL): secrets and the
    encryption key go to `~/.local/share/relay/secrets.json` instead, readable
    only by you but not encrypted. Settings → Storage shows when this is in
    use, and they move into a keychain once one is running
  - Lock projects behind Touch ID. Unlocks expire
  - Private projects only reach private providers: models you run or control,
    marked in Settings → AI (Ollama and LM Studio start marked at their local
    addresses). Unlocking a project doesn't change that
  - Settings → Security & privacy shows where each kind of data goes, with
    links to the [threat model](docs/threat-model.md) and how to report a
    vulnerability ([SECURITY.md](SECURITY.md))
  - Per-subsystem logs, held in memory only
  - Notifications: errors, failed Buffer posts, updates and publish results
    stay in a pane at the foot of the sidebar
  - Remembers the view and post you had open, each board's filters, view and
    collapsed columns, and the Buffer tab. `⌘\` shows or hides the sidebar; ⌘?
    lists every keyboard shortcut
  - Only one Relay runs at a time; opening it again brings the first one
    forward
  - Settings → Storage → Clear all data deletes everything Relay stores (posts,
    sign-ins and keys in the keychain, settings, caches, webview storage) and
    quits. The Windows uninstaller offers the same as an option. On macOS and
    Linux, clear data before deleting the app
  - Runs in the background with a tray icon. Its menu shows the version and
    commit, and About Relay… opens Settings → About (version, build, commit,
    commit date, platform, Go and Wails, with Copy build info)
  - Dev builds show the commit (with `-dirty` for uncommitted changes)
    instead of the version, in the Dev mode tag, Settings and the tray
  - Checks GitHub's releases at launch and offers a newer version. On macOS
    and Windows it can download it, check it against the
    release's `SHA256SUMS` and install it when you say so; elsewhere it opens
    the download page. Nothing installs without you asking. Turn the check off
    in Settings → Privacy
  - What's new: after an update, Relay shows what changed the first time it
    opens; Settings → About lists every release's changes
  - Settings → About → Report a bug opens a GitHub issue with only your
    version and platform filled in
  - CI builds for macOS, Windows and Linux, published as releases with a
    `SHA256SUMS` file and steps for opening unsigned builds (Windows:
    [SmartScreen guide](docs/windows-smartscreen.md))

### Planned

- Plugins: every feature (Plane, Dev.to, Buffer, Terminal) as an
  out-of-process plugin, with the trust pieces (vault, keychain, unlock, AI
  routing, logs) in an open core
- `relay mcp`: an MCP server so agents can work with the running app
- `relay` CLI on the same control socket
- Shell integration and Warp-style command blocks
- Session switcher, plus block actions (copy, re-run, save, find, pin)
- Git: a changes panel, a diff viewer and code review
- Command palette for commands, files and workspaces
- More promotion channels, plus threads for X, Threads and Bluesky
- Image upload for Dev.to and Buffer
- Unlock on Windows and Linux

## Getting started

Requires Go (the version in `go.mod`), Node 22, and the
[Wails v3 CLI](https://v3.wails.io/getting-started/installation/).

```sh
wails3 dev     # run with hot reload
wails3 build   # production build in bin/
```

On first run the setup guide opens. Settings live in `config.toml` in the
project root (or the OS app-config dir); secrets (the Dev.to key and the Plane
client secret, plus Buffer's tokens and optional insights key) are kept in
the OS keychain instead, and any found in an older
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
| `internal/` | `plane`, `devto`, `buffer`, `planning`, `ai`, `posts`, `term`, `vault`, `keychain`, `unlock`, `backup`, `logs`, `config` |
| `frontend/` | React and TypeScript UI |
| `site/` | [relay.shadowcrawler.dev](https://relay.shadowcrawler.dev): landing page, downloads, status and the Buffer sign-in callback (`site/public`, tests in `site/test`), published by `.github/workflows/pages.yml` |
| `design/` | UI spec (`design/README.md`) and reference mockups |
| `docs/` | [Threat model](docs/threat-model.md) and the [Windows SmartScreen guide](docs/windows-smartscreen.md) |
| `CHANGELOG.md` | What's new in each release (built into the app) |
| `SECURITY.md` | How to report a vulnerability |
| `Project.md` | Intent and Dev.to API notes |

## License

[BSD 3-Clause](LICENSE).

The passphrase words come from the [EFF large wordlist](https://www.eff.org/dice)
(`internal/backup/words.txt`), CC BY 3.0, by the Electronic Frontier Foundation.
