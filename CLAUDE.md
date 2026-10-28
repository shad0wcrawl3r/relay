# Relay

Wails3 desktop workbench: a custom Plane (app.plane.so) kanban frontend via
Plane OAuth + a Dev.to markdown editor/publisher.

## Read first
- `design/README.md` — full UI spec, behaviour decisions, design tokens, open questions.
- `design/kanban/*.dc.html`, `design/editor/*.dc.html` — reference mockups
  (design-canvas format, not runnable; sample data lives in each file's
  `renderVals()`). Rebuild them, don't import them.
- `Project.md` — intent + Dev.to article API reference.

## Stack
- Backend: Go, Wails v3 (`github.com/wailsapp/wails/v3`), module `github.com/shad0wcrawl3r/relay`.
  Config via viper from `config.toml` (`[devto] API_KEY`, `[plane] BASE_URL/CLIENT_ID/CLIENT_SECRET`), env prefix `RELAY`.
  `internal/api` (gin, currently unused), `internal/config`, `internal/plane` (OAuth — empty stub).
- Frontend: `frontend/` — React 18 + TS + Vite. **Target: Tailwind + shadcn/ui (zinc, dark)**; not installed yet.
- Build/run: `wails3 dev`, `wails3 build` (Taskfile).

## Rules
- Plane is the source of truth; Relay writes changes back, keeps no own copy of Plane state.
- TEACH project data: memory only, never written to disk or logs.
- Dev.to: send as `published: false`; no image upload in v1 (insert `<INSERT IMAGE HERE: …>` placeholders).
- Posts are local markdown files in the OS app-storage dir.
- Never commit `config.toml` or log secrets.
