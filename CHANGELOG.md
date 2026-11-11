# Changelog

What's new in each Relay release. Relay shows the new entries once, the first
time it opens after an update, and keeps all of them in Settings → About.

Each release is a `## X.Y.Z — YYYY-MM-DD` heading followed by `- ` lines.
Work that hasn't shipped yet goes under `## Unreleased`; the release PR renames
that heading to the new version.

## Unreleased

- What's new: after an update, Relay shows what changed the first time it opens.
- Settings → About lists every release's changes.
- Undo: moving an item on a board or from Attention, rescheduling and deleting a draft can be undone from the toast.
- Notifications: errors, failed Buffer posts, updates and publish results stay in a pane at the foot of the sidebar.
- Relay reopens the view and post you had open, and each board remembers its filters, view and collapsed columns.
- ⌘\ shows or hides the sidebar; ⌘? lists every keyboard shortcut.
- Attention: J and K move through items; Enter opens, D, S and A run Done, Send back and Approve.
- Posts: a status strip shows where a post is (local, draft on Dev.to, published, promoted); after promoting, See on Timeline opens the day.
- Toasts pause while the pointer is over them, and errors stay until you close them.
- The Dev.to editor is now called Posts in the sidebar.
- The sidebar keeps its spacing when it's collapsed to icons; the Relay mark expands it.

## 0.0.7 — 2026-11-10

- Timeline: a daily and weekly view of Buffer posts, Dev.to articles, Plane items due and cycle dates.
- Promotions can schedule follow-up posts three days and a week later, each with the article link.
- Ship log: draft a Buffer post from finished work, beside Draft article.
- Buffer ideas: Write an article turns an idea into a new post.
- Relay tells you when Buffer couldn't publish a post, at launch and every 15 minutes.
- Buffer rate limits: Relay waits out the limit instead of asking again, and the Timeline reuses what it loaded.

## 0.0.6 — 2026-11-10

- Ship log: draft a build-in-public post from the work you finished in Plane and the commits you made.
- Posts: mark an article AI-assisted or AI-generated; Relay adds the disclosure when it sends it to Dev.to.
- Promotions always carry the article's link, with a preview of each post before it goes out.
- The Buffer tab opens on its last data while it refreshes.
- Settings → About and the tray show the version and how this copy was built.

## 0.0.5 — 2026-11-09

- Plan in Buffer (experimental): a board of Buffer content items, with or without Plane.
- Buffer: write a post without an article.
- Zoom every view with ⌘/Ctrl + and −.
- Dev builds are marked with a Dev mode tag.
- Linux without a keychain keeps secrets in a private file instead.
- Fixes to the Buffer board and ideas.

## 0.0.4 — 2026-11-09

- Relay checks for a new release at launch and can download, verify and install it.
- Only one Relay runs at a time; opening it again brings the first one forward.
- Quick capture can save what you type as a Buffer idea.
- Clear all data from Settings (and from the Windows uninstaller).
- AI settings: test a model before saving it.
- Project order, colours and quick capture targets come from Settings.

## 0.0.3 — 2026-11-06

- Private projects only reach AI providers you mark as private.
- Choose your terminal shell from the ones installed; export and import settings.
- Dev.to key: check and save it beside the field.
- Releases come with checksums and steps for opening unsigned builds.

## 0.0.2 — 2026-11-05

- First public build: a Plane kanban, a Dev.to editor and a built-in terminal.
- Buffer: sign in, promote published articles on LinkedIn and keep ideas in sync with your boards.
- Secrets live in the OS keychain and stored data is encrypted; lock projects behind Touch ID.
- A setup guide walks through connecting each service.
- Relay runs in the background with a tray icon.
