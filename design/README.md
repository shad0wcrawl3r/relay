# Relay — design handoff

Exported 2026-10-28 from two Claude Design canvases:

- **Kanban** (Plane frontend) — https://claude.ai/artifact/BNVk41KsxmWo17jyn82FUT
- **Dev.to editor** — https://claude.ai/artifact/YZk496ixoG63CtumTnnAgM
- **Terminal** (added 2026-10-29) — https://claude.ai/artifact/4ADnBCRVu9vGWMgqKsFEEF

The `.dc.html` files are **reference mockups, not runnable code**. They use a
design-canvas runtime (`support.js`, `<x-dc>`, `<sc-for>`, `<sc-if>`,
`<dc-import>`, `{{hole}}` bindings and a `renderVals()` class holding sample
data). Read them for layout, spacing, colors, copy and sample data, then
rebuild in React + Tailwind + shadcn/ui. All data in them is fake.

```
design/
  README.md          ← this file (spec + tokens + decisions)
  kanban/            Attention.dc.html, Main.dc.html (board), Lanes.dc.html,
                     Detail.dc.html (item drawer), Capture.dc.html (⌘K)
  editor/            Main.dc.html (edit), Preview.dc.html,
                     ImageDialog.dc.html, Sent.dc.html
  terminal/          Main.dc.html (split workspace), Blocks.dc.html (block
                     states), Switcher.dc.html (prefix mode + ⌃B s),
                     FullScreen.dc.html (zoomed pane, nvim), Settings.dc.html
  */canvas.json      artboard index (titles, sizes) — ignore otherwise
```

---

## 1. Product shape

Relay = a Wails3 desktop workbench with two halves:

1. **Project management** — a custom frontend over Plane (app.plane.so),
   connected as a **Plane OAuth app**. All state is fetched from Plane; edits
   are written back. Relay keeps no source-of-truth of its own.
2. **Writing** — a markdown editor for Dev.to posts, publishing via the
   Dev.to API key.
3. **Terminal** — an embedded, tmux-like terminal: sessions live in the Go
   backend and keep running in the background; splits, tabs and Warp-style
   command blocks are implemented in the app itself (no tmux dependency).
4. **Settings** — OAuth client + Dev.to API key, terminal, plus other settings.

### Plane workspace model (what the UI assumes)

| Project | Key | Purpose | Custom states (in board order) |
|---|---|---|---|
| Work | `WORK` | module-based projects (e.g. Log Parser) + one-off action items | Backlog, Todo, Ready for Agent, Agent Working, In Progress, Blocked, Needs Review, Done, Cancelled |
| Lab | `LAB` | Side-project ideas an agent expands and debates in comments | Idea, Ready for Agent, Agent Working, In Debate, Approved, Building |
| Teaching | `TEACH` | teaching notes (private) | includes Needs Review, Waiting on Student, … |

- Agent handoff happens **inside each project** via states (Ready for Agent →
  Agent Working → Needs Review / In Debate), not a separate project. The agent
  is Claude Code.
- **Teaching is private**: encrypted at rest and **locked** — hidden until
  unlocked (Touch ID / login password). UI shows a lock glyph on it everywhere.
- Plane is on cloud now; self-hosting later (so `BASE_URL` must be
  configurable — it already is in `config.toml`).

---

## 2. Screens

### Kanban canvas (1440×900 frames, fluid)

**App shell (shared by all kanban screens)** — 220px left sidebar:
brand "R Relay" · **Attention** (pink count badge) · section "Plane projects"
(Work / Lab / Teaching, each with colored letter glyph + item count; Teaching
shows a lock instead of a count) · section "Write" → Dev.to editor · spacer ·
sync status ("● Synced 14s ago" + sync-now icon button) · Settings.

1. **Attention (home)** — `kanban/Attention.dc.html`
   Cross-project inbox of things waiting on the user. Header "Attention" +
   "N items across 3 projects are waiting on you." + segmented filter
   (All / Work / Lab / Teaching with counts). Grouped sections:
   - *Needs review* — agent output handed back → actions **Done · Send back · Open**
   - *In debate* — Lab ideas where the agent replied ("your turn") → **Reply · Approve · Shelve**
   - *Blocked* → **Unblock · Open**
   - *Overdue* — past target date (subtitle in red) → **Reschedule · Open**
   Row: project glyph · mono ID · title (+lock if Teaching) · subtitle · state pill · actions (first is primary).
   Footer note: Teaching is encrypted on disk and hidden until unlocked.

2. **Work board** — `kanban/Main.dc.html`
   Top bar: glyph + "Work" + mono key · view toggle **Board | Lanes** ·
   Filter · Module ▾ · Label ▾ · Priority ▾ · Cycle ▾ · search ("Search WORK…", ⌘F) · **New item** (primary).
   Columns 264px wide; Backlog, Done, Cancelled **collapsed** to 40px vertical
   strips (dot + count + vertical label, click to expand). Column header: dot,
   name, count, "+" button. "Add item" at column bottom.
   **Card**: mono ID · priority (urgent = orange "!" tile; else 3 ascending
   bars) · title · optional red note (blocked reason) · label chips · meta row
   (module, due date — red if overdue, comment count, "agent" tag or pulsing
   "working · 12m").
   Card variants: `needs` (pink border + glow, Needs Review), `working`
   (indigo border, Agent Working).

3. **Work board — module lanes** — `kanban/Lanes.dc.html`
   "Group by: Module". Hidden columns shown as dashed pills (Backlog 14,
   Done 9, Cancelled 2). 6-column grid of state headers, then a swimlane per
   module: name, "5 open · 2 done", green progress bar. Final lane "No module"
   for action items. Compact mini-cards; empty cells dashed.

4. **Lab board + item drawer** — `kanban/Detail.dc.html`
   Lab board ("New idea" primary) with a 580px right drawer over a scrim.
   Drawer header: glyph, ID, prev/next, open-in-Plane, close. Body: title;
   property list (State picker, Priority, Labels + add, Created, "Picked up
   by: Claude Code"); Description; tabs **Comments | Activity**; thread with
   agent (indigo bot avatar + "agent" tag) and user comments. The agent's
   first comment is structured: *Expansion · Case for · Case against ·
   Verdict pill · First 3 steps*. Composer: markdown textarea, "⌘↵ to send",
   **Shelve · Approve · Comment**. Cards on Lab show "your turn" in pink.

5. **Quick capture (⌘K)** — `kanban/Capture.dc.html`
   Centered 640px command palette over a dimmed board. Input ("Capture an idea
   or run a command"). "Create in" target chips with default state:
   Lab · Idea / Work · Backlog / Teaching · Backlog; **Queue for agent** switch
   (→ creates in Ready for Agent). First option "Create idea in Lab → Idea ↵".
   "Go to" commands with shortcuts: Attention `G A`, Work `1`, Lab `2`,
   Teaching `3`, Dev.to editor `E`, Sync now `⌘R`. Footer: `↵` create, `⌘↵`
   create & open, `⇥` cycle project, `⌘K` open from anywhere.

### Dev.to editor canvas (1280×1000 frames, fluid)

**Shell**: 56px icon rail (logo, Projects, Posts [active], spacer, Settings)
+ 280px **Posts** sidebar: header + "New post" · search · segmented
All 7 / Drafts 3 / Published 4 · grouped list. Each post: title + status
badge + subtitle:
- `Draft` + "Local only · edited just now" (never sent)
- `Draft` + "On Dev.to · Oct 24" (sent as unpublished draft)
- `Published` (green) + "Oct 9 · 1.2k views"
Footer: sync button + "Synced with Dev.to · 2 min ago".

1. **Edit** — `editor/Main.dc.html`
   Breadcrumb "Posts / <title>" + **Edit | Preview** toggle. Centered 860px
   column: dashed "Cover image — add on Dev.to" reminder chip · big title
   (44px/700) · tag chips with remove × + "Add tag (3 of 4)" input ·
   formatting toolbar (Bold, Italic, Link | Ordered, Bulleted, Heading, Quote
   | Inline code, Code block, Embed, **Insert image placeholder** [amber] …
   More = canonical URL, series, description) · code-style editor body:
   Geist Mono 14/22, **line numbers in a very pale gutter (#3f3f46,
   LazyVim-like)**, active line tinted, caret. Light markdown highlighting:
   `##`/`**`/`[]()` punctuation dimmed (#52525b), heading/bold text bright,
   code fences grey, keywords violet, functions/links blue, image
   placeholders as amber pills.
   Footer: "● Saved locally · just now" · amber "2 images + cover to add on
   Dev.to" · "Creates an unpublished draft" · **Send to Dev.to**.
   After sending (prop `sent`): footer shows blue dot "Draft on Dev.to · sent
   just now", **Open on Dev.to** + **Update draft**.

2. **Preview** — `editor/Preview.dc.html`
   Rendered article (760px): cover placeholder block, H1, `#tags`, body
   17/1.75, code blocks, image placeholders rendered as amber dashed figures
   with the description as caption.

3. **Insert image placeholder dialog** — `editor/ImageDialog.dc.html`
   460px modal: "Describe the image. You'll swap it for the real one when you
   finish the draft on Dev.to." Description input; live preview of the token
   that gets inserted at cursor: `<INSERT IMAGE HERE: architecture diagram>`.
   Cancel / Insert.

4. **After send** — `editor/Sent.dc.html`
   Bottom-right toast: ✓ "Draft created on Dev.to" / "Unpublished. Add 2
   images and the cover there, then publish." **Open in browser** · Dismiss.

### Terminal canvas (1280×1000 frames, fluid)

**Shell**: same 56px icon rail as the editor with a new **Terminal** entry
(square-terminal icon) between Posts and Settings. When the terminal view is
not open, the rail icon carries a small blue dot while any session is
running (see `Settings.dc.html`). Then a 248px **Sessions** sidebar
(collapsible to a 52px strip of status dots, see `FullScreen.dc.html`).

1. **Split workspace** — `terminal/Main.dc.html`
   - Sessions sidebar: groups *In this tab · N* and *Background · N*. Row =
     status dot + name + right meta (`exit 1` red / elapsed blue / `idle` /
     `done` green) and a mono subline (process or `shell · cwd`). Footer
     note: sessions keep running when switching views or hiding to tray.
   - Header (48px): tabs (active = 2px bottom border, "3 panes" chip; a
     background tab with activity shows a blue dot), **+** new tab,
     "Sessions ⌃B s" button, split right, split down, zoom.
   - Panes: layout tree (left pane, right column split top/bottom), 5px
     resize gutters with a 1px `#27272a` line. Each pane: 36px header
     (session name + process, close ×); focused pane = header `#18181b`
     and `inset 0 0 0 1px #3f3f46` ring.
   - Blocks stack bottom-up above the input (`justify-content: flex-end`).
     Block header row: collapse chevron · cwd · git branch (violet, branch
     icon) or kube context chip · spacer · duration · ✓ / `exit N` pill.
     Command line in Geist Mono 13/20 weight 500 `#fafafa`; output below.
   - Selected block: `inset 0 0 0 1px #52525b` (failed: red at .45), floating
     action bar top-right: Output (copy) · Command (copy) · Re-run · ⋯.
   - Input box per pane: cwd + branch line, `❯` prompt (violet), single-line
     input, "⇧⏎ new line" hint. Focused pane's input gets a `#52525b` border.
   - A pane running a long process (`wails3 dev`) shows a running block
     (blue tint, spinner, elapsed) and replaces the input with a dashed
     note "Input goes to wails3 dev · ⌃C to stop".
   - Status bar: `⌃B` prefix · "zsh integration on · blocks active" ·
     "6 sessions · 2 running" · focused pane name.
   - Tweak `density`: comfortable (block padding 14/16) or compact (8/16).
2. **Block states** — `terminal/Blocks.dc.html`: running, succeeded (D;0),
   failed (red tint + `exit N`), selected with ⋯ menu (Copy as Markdown,
   Save output to file…, Find in output ⌘F, Pin to top, Clear block),
   collapsed (one line: command · "N lines" · duration · result),
   long output (cap at 40 lines once finished, fade, "Show all N lines" /
   "Open in pager"), interrupted (amber, `stopped`, exit 130), and no shell
   integration (plain stream + banner "Blocks are off — no marks from
   /bin/sh" → **Set up** opens Settings).
3. **Prefix mode + session switcher** — `terminal/Switcher.dc.html`
   - Pressing the prefix shows a bottom key strip: `%` split right, `"`
     split down, arrows focus, `z` zoom, `s` sessions, `d` send to
     background, `c` new tab, `x` close pane, `[` select mode, esc cancel.
   - `⌃B s` opens a 640px switcher over a dimmed workspace: search, groups
     *Background* and *In this tab*, preview of the picked session's last
     lines. Keys: `⏎` attach to pane · `⌥⏎` open in split · `⌘⏎` new tab ·
     `⌃X` kill.
4. **Zoomed pane, full-screen app** — `terminal/FullScreen.dc.html`
   Tab chip "zoomed · 1 of 3" + "Restore splits ⌃B z". Pane header badge
   "Blocks paused · full-screen app". The pane renders the raw alt-screen
   (nvim) edge to edge. Footer: every key goes to the app except the prefix;
   `⌃B ⌃B` sends a literal ⌃B; blocks resume when the app exits.
5. **Settings — Terminal** — `terminal/Settings.dc.html`
   Settings gets a section nav (Plane, Dev.to, Terminal, Appearance, About).
   Terminal: default shell, start folder (focused pane's / home / fixed),
   **Shell integration** auto-load switch + per-shell status table (zsh
   Active, bash "Test in new session", fish not installed), prefix key
   (`⌃B`, Record new), double-press-to-send-literal switch, keep running when
   window closes (tray), **When Relay quits**: Ask if anything is running
   (default) / End all sessions / Keep in background service (disabled,
   "later version"), scrollback (10 000 lines), font, cursor style.

### Timeline (no mockup; built in `frontend/src/views/timeline/Timeline.tsx`)

Top-level sidebar entry under Attention, shown with or without Plane; key `L`,
and in ⌘K. One place for what's going out, what's published and what's due:
Buffer posts (scheduled, awaiting approval, sent, failed), published Dev.to
articles, open Plane items with a target date, and cycle starts and ends.
Every source is optional; locked projects never appear.

1. **Daily** — the day in full, one card per entry, Plane dates first then
   timed posts in order. Buffer cards show the channel, a status badge, the
   whole text, Buffer's error and a "View post" link once sent; articles show
   views and open in the editor; Plane items open in the item drawer. Arrows
   step a day; "Today" returns.
2. **Weekly** — a strip of seven small day cards (date, status dots, Dev.to
   and due marks, a short count; failures in red) above the selected day's
   Daily list. The weeks before and after peek in as faded, half-height rows
   (bottom half above, top half below); clicking one, or the arrows, steps a
   week. The choice of view is remembered per machine.

Loading: the frontend waits 350 ms after the last step, then asks once for
the visible weeks plus the peeking ones. Go keeps each organization's post
lists in memory for 3 minutes and only extends them past what's loaded
(at most 5 pages a call, 20 a list); any write through Relay or sign-out drops
them, Refresh reads again. After a 429 the Buffer client refuses every call
until Retry-After passes and the timeline shows what it has with a note.

---

## 3. Behaviour decisions (v1)

Buffer
- Promotions (LinkedIn) can add two follow-ups, 3 days and a week after the
  first post, each with its own text. They're ordinary scheduled promotions,
  so Go adds the article link to each. Not offered for drafts.
- The ship log drafts either an article or a short Buffer post (sized for
  the strictest usable channel), which opens in the composer unsent.
- Buffer ideas can start a local Dev.to article ("Write an article").
- Failed posts: Go checks at launch (+20 s) and every 15 min, and raises one
  toast per newly failed post, linking to the Failed tab. Only IDs, channel
  and error travel; never the post text.

Editor
- Simple editor, close to Dev.to's own. Markdown source is the document.
- **No image upload in v1.** Image button inserts
  `<INSERT IMAGE HERE: <description>>`; cover image is a reminder only.
  Footer counts outstanding placeholders + cover.
- Send = `POST /api/articles` with `published: false`. User finalises and
  publishes on Dev.to. Re-send on an already-sent post = update
  (`PUT /api/articles/{id}`) — "Update draft".
- Field mapping (from `Project.md`): `title→title`, `content→body_markdown`,
  `tags→tags` (max 4, comma-separated), `series→series`; `description`,
  `canonical_url` via the "More" menu. `main_image` not used in v1.
- Posts stored **locally as markdown files** in the platform's app storage
  dir (e.g. `os.UserConfigDir()/relay/posts/`). Sidebar lists all posts:
  local files merged with the user's Dev.to articles
  (`GET /api/articles/me/all` gives published state + page views).
- Minor syntax highlighting; very pale line numbers.
- Scrollbars overridden everywhere: thin, minimal, rounded thumb, no
  track/buttons (Claude-style). See tokens.

Kanban
- Plane is source of truth; Relay reads everything via OAuth and writes
  changes back (state moves via drag, comments, create, approve/shelve…).
- Teaching is locked: stored only encrypted, hidden until unlocked with
  Touch ID or the login password, relocks after the auto-lock timeout.
  Projects and modules can be locked in Settings → Privacy.
- Launch shows the last good sync from an encrypted display cache with a
  "Saved data · syncing…" banner; moving, editing, creating and commenting
  are blocked until the first live sync.
- Attention view is the home screen.

Terminal
- **Go owns sessions.** PTY via `github.com/aymanbagabas/go-pty` (Unix PTY
  + Windows ConPTY). A session manager maps `sessionID → {pty, process,
  ring buffer, block index, headless VT}`; the React side only attaches and
  detaches, so sessions survive view switches and window hide.
- **Reattach** from a per-session headless VT emulator
  (e.g. `github.com/charmbracelet/x/vt`) snapshot, not raw-byte replay, so
  TUIs redraw correctly.
- **Transport**: Wails bindings/events for control (create, resize, kill,
  focus); output and input over a localhost WebSocket bound to 127.0.0.1
  with a per-launch token, flushed in ~8–16ms batches.
- **Blocks** need shell integration: on spawn, inject an init script
  (bash `--rcfile`, zsh `ZDOTDIR`, fish `--init-command`) that emits OSC
  133 `A/B/C/D;exit` marks and OSC 7 cwd; never edit the user's dotfiles.
  Go parses marks into block records `{id, cmd, cwd, branch, exit,
  start/end, output range}`.
- **Rendering**: one xterm.js instance per pane; blocks drawn with
  `registerMarker` + `registerDecoration` (borders, tints, action bar,
  collapse), not separate DOM per block. Suspend block mode while the
  alternate screen is active (DECSET 1049).
- **Splits**: per-tab layout tree, node `{dir: "h"|"v", sizes, children}`
  or leaf `{sessionId}`, rendered recursively with shadcn `Resizable`
  (react-resizable-panels). Split/close/focus/zoom are pure tree ops.
  Persist layout to the app config dir.
- **Quick terminal**: `⌘/` or `⌃/` in any other view opens a bottom panel
  (resizable, `⌘/` again hides it). From Plane views it resumes the last
  quick session or starts one in the home folder; from the editor it uses
  its own session in the posts folder. Sessions keep running when hidden;
  "Terminal" moves one into a tab of the Terminal view.
- **Prefix** defaults to `⌃B`; configurable. No global keydown hijacking
  outside the terminal view.
- **Scope**: sessions survive closing/hiding the window (tray). Surviving
  an app *quit/restart* (sidecar daemon over a unix socket) is v2 — shown as
  a disabled option in Settings.
- **Build order**: (1) single pane PTY ↔ xterm + resize, (2) session
  manager + detach/reattach, (3) split tree + tabs, (4) OSC 133/7 + block
  decorations, (5) block actions, switcher, settings.

---

## 4. Design tokens

Both canvases are dark, zinc-based, matching shadcn/ui's **zinc** theme —
use shadcn's zinc dark palette as the base and add the custom tokens below.

**Core (zinc)**
| token | hex |
|---|---|
| background | `#09090b` |
| sidebar / rail bg | `#0c0c0e` |
| column body | `#0e0e10` (border `#17171a`) |
| card | `#16161a` (border `#26262b`, hover `#3a3a42`) |
| muted surface | `#18181b` |
| border | `#27272a` (kanban hairlines `#1f1f23`) |
| border strong | `#3f3f46` |
| text dim | `#8b8b94` / `#71717a` |
| text muted | `#a1a1aa` |
| text | `#e4e4e7` |
| text strong | `#fafafa` |
| primary button | bg `#fafafa`, fg `#09090b` |

**Plane states**
| state | color |
|---|---|
| Backlog, Todo | `#60646c` |
| Ready for Agent | `#3b82f6` |
| Agent Working | `#6366f1` (pulse dot `#818cf8`, card border `#3e3f8f`) |
| In Progress, Building | `#f59e0b` |
| Blocked, Waiting on Student | `#ef4444` |
| Needs Review, In Debate | `#ec4899` (card border `#8a2e5c` + `0 0 0 1px rgba(236,72,153,.28)`) |
| Done | `#46a758` |
| Cancelled | `#9aa4bc` |
| Idea | `#a855f7` |
| Approved | `#14b8a6` |
| Overdue text | `#f87171`; overdue group dot `#f97316` |

**Project glyphs** (20px, radius 5): Work bg `#1e293b` fg `#93c5fd` ·
Lab bg `#2e1a47` fg `#d8b4fe` · Teaching bg `#123534` fg `#5eead4`.
Attention badge: bg `#4a1d35` fg `#fbcfe8`.

**Priority**: 3 bars (3px wide, 4/7/10px tall), on `#d4d4d8`, off `#3f3f46`.
Urgent = 16px tile bg `#7c2d12` fg `#fdba74` with "!".

**Agent**: text `#a5b4fc`, avatar bg `#1e1b4b`, tag border `#312e81`.
Verdict pill: bg `#0d2a27` fg `#5eead4`.

**Editor syntax**: md punctuation `#52525b` · fences `#71717a` · keyword
`#c4b5fd` · function/link `#93c5fd` · gutter `#3f3f46` (alt `#27272a` /
`#52525b`) · active line `rgba(255,255,255,.035)`.
Image placeholder: bg `rgba(245,158,11,.12)`, border `rgba(245,158,11,.32)`,
text `#fbbf24`. Published badge: bg `rgba(74,222,128,.1)` fg `#4ade80`.

**Terminal**: pane bg `#0c0c0e` · pane hairline `#1f1f23` · block divider
`#1c1c1f` · selected block bg `#131316` · prompt `❯` / branch `#c4b5fd` ·
running `#60a5fa` (text `#93c5fd`, block tint `rgba(96,165,250,.04)`) ·
success `#4ade80` · failed `#f87171` (text `#fca5a5`, pill bg
`rgba(248,113,113,.14)`, block tint `rgba(248,113,113,.05)`) · interrupted
`#fbbf24` (text `#fcd34d`, tint `rgba(251,191,36,.04)`) · idle dot
`#52525b`. Popovers/dialogs `#111113`/`#18181b` with `#3f3f46` border.
Mono: Geist Mono 13/20 in panes.

**Scrollbar** (editor canvas version — preferred):
```css
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}
::-webkit-scrollbar-button{display:none}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:999px;border:3px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28)}
```

**Type**: Kanban canvas uses Inter + JetBrains Mono (13px base, 11px
uppercase section labels, letter-spacing .06em). Editor canvas uses Geist +
Geist Mono. **Pick one** (see open questions).

**Radii**: buttons/inputs 6, cards 8, columns/groups/dialogs 10, pills 999.
**Icons**: stroke icons, 1.8–2px — Lucide matches (shadcn default).

---

## 5. Open questions (decide before/while building)

1. **Unify the shell.** The two canvases were designed separately: kanban
   has a 220px labelled sidebar (Inter); editor has a 56px icon rail + 280px
   posts list (Geist). Needs one shell — e.g. the labelled sidebar collapsing
   to the icon rail when the editor is open.
2. **One font family** — Inter/JetBrains Mono vs Geist/Geist Mono.
3. **Window size** — `main.go` opens 1000×618; designs assume 1280–1440 wide.
4. **How a card is marked "agent"** (label? comment author? state history?).
5. **Sync model** — polling interval vs Plane webhooks (webhooks only after
   self-hosting); Dev.to sync cadence.
6. Settings screen: only the Terminal section is designed
   (`terminal/Settings.dc.html`); reuse its layout for OAuth connect,
   Dev.to key, storage path, sync interval, Plane base URL.
7. Terminal: the terminal canvas uses the editor's 56px rail — another
   input for question 1.
