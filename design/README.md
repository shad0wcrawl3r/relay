# Relay — design handoff

Exported 2026-10-28 from two Claude Design canvases:

- **Kanban** (Plane frontend) — https://claude.ai/artifact/BNVk41KsxmWo17jyn82FUT
- **Dev.to editor** — https://claude.ai/artifact/YZk496ixoG63CtumTnnAgM

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
3. **Settings** — OAuth client + Dev.to API key, plus other settings.

### Plane workspace model (what the UI assumes)

| Project | Key | Purpose | Custom states (in board order) |
|---|---|---|---|
| Work | `WORK` | module-based projects (e.g. Log Parser) + one-off action items | Backlog, Todo, Ready for Agent, Agent Working, In Progress, Blocked, Needs Review, Done, Cancelled |
| Lab | `LAB` | Side-project ideas an agent expands and debates in comments | Idea, Ready for Agent, Agent Working, In Debate, Approved, Building |
| Teaching | `TEACH` | teaching notes (private) | includes Needs Review, Waiting on Student, … |

- Agent handoff happens **inside each project** via states (Ready for Agent →
  Agent Working → Needs Review / In Debate), not a separate project. The agent
  is Claude Code.
- **Teaching is private**: fetched live, held in memory only, **never cached to
  disk**. UI shows a lock glyph on it everywhere.
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
   Footer note: "Teaching items are fetched live and kept in memory only — never cached to disk."

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

---

## 3. Behaviour decisions (v1)

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
- Teaching never touches disk.
- Attention view is the home screen.

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
6. Settings screen isn't designed yet (OAuth connect, Dev.to key, storage
   path, sync interval, Plane base URL).
