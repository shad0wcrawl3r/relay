# Relay UX scheme (draft for review)

Drafted 2026-11-11 from a pass over the frontend. The visual design stays as
it is; this is about how Relay behaves: what it tells you, what it remembers,
what you can undo, and how one task leads to the next.

**Timing.** Submissions close Nov 13 and judging runs Nov 16–20 with no risky
changes. So the work is split: **Phase A** is small, frontend-only and safe to
ship in 0.0.8 before submitting (and it helps the demo); **Phase B** waits
until after judging. Each item is marked A or B, with a rough size.

## Decisions (2026-11-11 review)

- **Built now, on `feat/ux-touchups`:**
  - §1: Undo, toasts, one delete rule, and the notification pane (brought
    forward from B).
  - §2: last view and post reopen, board prefs are remembered, ⌘\ toggles the sidebar.
  - §3: `Page` / `PageHeader`, skeletons, empty states.
  - §4: the post status strip, Promote → See on Timeline, and Posts as the sidebar name.
  - §5: the shortcut sheet on **⌘?**, not `?`.
  - §7: Attention keys and focus rings.
  - AI preload, which is new (see below).
- **Backlog:**
  - back and forward (RELAY-124; needs a model of what a step is);
  - Ready to write about (RELAY-125; needs RELAY-71);
  - the ⌘K command palette (RELAY-91).
- **Corrections to the draft:**
  - The Promote dialog only offers LinkedIn channels, so "Promote on LinkedIn"
    stays.
  - The Buffer plan limits are already a footnote, so nothing changes there.
- **AI preload:** Settings → AI → Preload (on by default; Ollama and LM Studio
  on this machine only) loads the model:
  - when Ship opens;
  - when the pointer or focus reaches an AI draft or summarise button.

  It never runs in the background, and it sends nothing of the user's.
- **§8 Buffer posts (built):**
  - The channel cards stay, so (5) was dropped.
  - Retry moves a failed post to the channel's next slot through the
    reschedule menu; Post again opens the composer.
  - Two additions beyond the draft: editing the text in place instead of the
    edit dialog, and dragging a post onto another day to reschedule it.
- **Open:** §6 Settings (layout and save model), below.

---

## Principles

1. **Every action can be undone or is confirmed first, the same way everywhere.**
2. **Nothing important disappears on a timer.**
3. **Relay remembers where you were.**
4. **Every view is built the same way:** same header, same loading, same empty state.
5. **The next step is always on screen.** Work done → Ship → article →
   published → promoted → on the Timeline.
6. **Shortcuts are easy to find**, not just mentioned in tooltips.

---

## 1. Feedback and undo

**What happens now**
- Attention's Done / Send back / Approve / Shelve and dragging on the board move
  an item right away. The only feedback is a 4-second "marked done" toast, with
  no undo (`lib/store.tsx` `update`).
- Toasts (`components/Toaster.tsx`): there's no pause on hover, toasts with
  actions have no close button, the info tone shows a green check, and at most
  four are kept, after which the oldest is dropped.
- Deleting works three different ways: click twice (Delete draft in
  `Editor.tsx`), a dialog (Buffer delete) and typing a word (Clear data).

**Proposal**
- **A · S** Plane state moves, due-date changes and shelving get an **Undo**
  button in their toast, which writes the old value back. It's frontend only:
  `update` already knows the item's previous state.
- **A · S** Toasts pause while the pointer is over them, always have a close
  button, and use an info icon for info. Errors stay until you close them.
- **A · S** One rule for deleting:
  - A **dialog** when it can't be undone or reaches another service (Buffer
    post, Dev.to, Clear data, where typing the word stays).
  - **Undo in a toast** for everything else.
  - Delete draft (a local file) moves to Undo: keep the file for the toast's
    lifetime and remove it afterwards.
- **B · M** A **notification inbox** (RELAY-92): a bell at the foot of the
  sidebar keeps failed Buffer posts, finished updates, sync errors and
  publish results after their toast is gone. It shows a count while there are
  unread entries.

## 2. Relay remembers

**What happens now**
- Every launch opens on Attention.
- Board filters reset when you switch project (`Board.tsx:135`).
- The sidebar shrinks to icons in the editor and the terminal whether you want
  it to or not.
- There's no back or forward.

**Proposal**
- **A · S** Reopen the last view (and the last post in the editor). Locked
  projects still show the lock screen.
- **A · S** Each project keeps its own board filters, Board/Lanes choice and
  collapsed columns, stored per machine in localStorage, like the Timeline's
  view.
- **A · S** **⌘\\** shows or hides the sidebar, and the choice is
  remembered. The editor and the terminal still default to icons only.
- **B · S** **⌘[ / ⌘]** go back and forward through views, and the drawer
  counts as a step.

## 3. One page frame

**What happens now**
- Attention, Buffer, Timeline and Settings each build their own header (a
  40 px drag strip, then a 22 px h1, a subtitle and actions).
- The editor uses an 84 px breadcrumb bar, the board has its own wrapping
  toolbar, and the terminal has a tab bar.
- Loading is plain text in several places ("Loading…", "Loading posts…",
  "Loading ideas…").

**Proposal**
- **A · S** Add a `PageHeader` (title, subtitle, actions, optional tabs) and
  use it in Attention, Buffer, Timeline and Settings. The editor, the board
  and the terminal keep their toolbars, but match its height and drag area.
- **A · S** Replace the loading text with skeleton rows shaped like the
  content, shown only after 150 ms so quick loads don't flash.
- **A · S** Each empty state names one next step as a button. For example:
  - "Nothing is scheduled": **Write a post**.
  - "No failed posts", with nothing to do: say so plainly, no button.
  - Attention empty: **Open Timeline**.

## 4. The publishing pipeline is visible

**What happens now**
- Each step works, but it lives in a different place:
  - Ship is in the editor's posts sidebar;
  - Publish and Promote are in the editor footer;
  - the results are in Buffer and the Timeline.
- After publishing, nothing suggests promoting, and after promoting nothing
  shows where it landed.
- The footer button says "Promote on LinkedIn" even when other channels are
  connected.

**Proposal**
- **A · M** Replace the editor footer's status text with a **post status
  strip**: `Local → Draft on Dev.to → Published → Promoted (2 scheduled)`.
  - The current step is lit and the next one is a button.
  - It replaces the separate dots and labels; the image-placeholder warning
    stays beside it.
- **A · S** Each step offers the next:
  - After **Publish**, the success toast offers **Promote**.
  - After **Promote**, it offers **See on Timeline**, which opens on the day of
    the first post.
- **A · S** Rename **Promote on LinkedIn** to **Promote**, since the dialog
  already picks channels. Rename the sidebar's **Dev.to editor** to **Posts**,
  which is what the view is.
- **B · M** In Attention, a **Ready to write about** group: items finished in
  the last week that no post has used yet, with a **Ship** action. This
  needs a record of which items a Ship draft used (RELAY-71).

## 5. Find and use shortcuts

**What happens now**
- There are single-key shortcuts (E, B, L, T, 1–9, G A) and the terminal
  prefix keys. You only find them in tooltips and the ⌘K list.
- ⌘K mixes capture with "go to"; it has no actions.

**Proposal**
- **A · S** **?** opens a shortcut sheet: a dialog grouped by view, built from
  the same table the key handler uses, so it can't drift out of date.
- **B · M** ⌘K becomes a full command palette (RELAY-91). It adds actions
  for the current context: *Send to Dev.to*, *Promote*, *New Buffer post*,
  *Ship*, *Lock private items*, *Check for updates*, and *Move FOO-12
  to…* when the drawer is open. Capture stays as the first row.

## 6. Settings

**What happens now**
- Eight tabs across the top.
- Some tabs save straight away (AI, Storage, Logs, About), while others need
  **Save settings** at the bottom. Nothing on screen says which kind a tab is.

**Proposal**
- **A · S** Each change saves on its own: the field shows a small "Saved ✓",
  or an error next to it. Drop the Save/Discard bar. Fields that need a
  check, like API keys and the Plane client, keep their own **Save** button
  beside them, as the Dev.to key field already does.
- **B · S** A left-hand section list instead of top tabs (RELAY-65), matching
  `design/terminal/Settings.dc.html`. Status dots show which services are
  connected.

  There are three ways to lay it out:
  - **(a) Rail | section list | content.** Opening Settings shrinks the main
    sidebar to its icon rail, as the editor and terminal do, then shows a
    180 px list of sections beside the content.
    - Every section is one click away and can be linked to.
    - It's the layout of macOS System Settings and VS Code.
    - At 1100 px minimum width this leaves 56 + 180 + about 860 px for the
      content.
  - **(b) Sections in the main sidebar.** Settings replaces the main nav with
    its own list and a "← Back" at the top, like Linear. This saves a column,
    but you lose the main nav while you're in Settings.
  - **(c) One page of collapsible sections (accordion).** No navigation
    column. It scans worse with nine sections, links can only open a section,
    and long sections (AI, Plane help) push everything below them down.

  **Recommendation: (a).**

## 8. Buffer posts

**What happens now**
- The Queue, Sent and other tabs are one flat list. Every row repeats a full
  date ("Due Wed, Nov 12, 9:00 AM"), so you can't see a schedule at a glance.
- The text is cut off at 3 lines and can't be expanded.
- The actions are bare icons (open, edit, delete) with no labels, and nothing
  copies the text.
- A failed post shows Buffer's error, but there's no way forward short of
  editing it or deleting it.
- Nothing shows that a post promotes one of your articles, although Relay
  records that locally.
- The tabs have no counts, so failures are invisible until you open Failed.
  The tab and the channel filter reset each visit.
- The channel cards take a full row above the tabs. Filtering by clicking a
  card isn't obvious, and the "show all" link is small.
- The edit dialog is a bare text box. It has no character limit, doesn't say
  which channel the post is for, and only offers a raw date-time field.

**Limits:** Buffer's API can list, read, edit (text and time), delete and
create posts. It can't share a post now, requeue it or reorder the queue. No
new per-click Buffer calls (CLAUDE.md).

**Proposal**
1. **A schedule, not a list.**
   - Queue and Awaiting approval are grouped by day, oldest first ("Today ·
     Wed 12 Nov", "Tomorrow", …).
   - Sent is grouped by day, newest first.
   - Each row has a time column (9:00) instead of a full date. Drafts stay in
     created order.
2. **Rows you can read and act on.**
   - Long text gets **Show more** and **Show less**.
   - Labelled actions appear on hover or focus: **Edit**, **Copy text**,
     **View post** (once sent) and **Delete**.
   - A **Promotes: "Article title"** chip opens the article in Posts. Relay
     reads it from its own promotion records, with no Buffer call.
3. **Failed posts get a way forward.**
   - The error shows as a red banner on the row, with Buffer's Help link.
   - **Retry** opens the edit dialog with the time set to the channel's next
     slot, which Buffer allows through a schedule edit.
   - When a post can't be edited, **Post again** opens the composer with the
     same text.
4. **Tabs that tell you something.**
   - Failed shows a red count, taken from the 15-minute failed-post check, so
     no extra Buffer calls.
   - Relay remembers the tab and the channel filter.
   - A **Search posts** box filters what's loaded, with no Buffer call.
5. **A channel chip row in place of the card grid.**
   - **All channels**, then one chip per channel (avatar, name, a warning dot
     when paused or disconnected), so the filter is obvious.
   - The posting goal and next slot move into each chip's tooltip.
6. **A better edit dialog.**
   - It shows the channel and a character count against that channel's limit,
     using the composer's existing checks.
   - Quick time picks: **Next slot**, **In 1 hour**, **Tomorrow 9:00**.
7. **Keyboard**, as in Attention: J/K to move, ↵ to expand, E to edit, C to
   copy, ⌫ to delete (with the confirm dialog). The shortcut sheet lists them.
8. Delete keeps its confirm dialog, since it can't be undone in Buffer.

**Questions**
- Channel chips in place of the cards (5), or keep the cards and make them
  look more like a filter?
- Retry on a failed post: is "edit the time to the next slot" right? The other
  option is always opening the composer with the same text.

## 7. Small fixes found along the way (all A · XS)

- Attention's action buttons have no shortcut. When a row has focus, **D**,
  **S** and **O** could run Done, Send back and Open, and **J** and **K**
  could move between rows.
- The Buffer subtitle names the plan limits and explains why metrics are
  missing. Move that into a small "About this plan" popover.
- Add visible focus rings to sidebar items and segmented controls. There are
  only 12 `focus-visible` styles in the app today.

---

## Questions for the review

1. **Scope for 0.0.8:** all of Phase A, or only §1, §2, §4 and the shortcut
   sheet? Those show up best in the demo.
2. **Deleting a local draft:** Undo (as proposed) or keep clicking twice?
3. **Settings:** save every change straight away (as proposed), or keep a
   Save button on every tab?
4. **Sidebar:** rename **Dev.to editor** to **Posts**?
