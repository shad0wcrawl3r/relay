import { Fragment, useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Columns2, Info, Maximize2, PanelLeftClose, PanelLeftOpen, Plus, Rows2, SquareTerminal } from "lucide-react";
import { useTerminal } from "@/lib/terminal";
import type { TermBinding, TermInfo, TermKeymap } from "@/lib/api";
import { keyName, showKey } from "@/lib/keys";
import * as L from "@/lib/layout";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { Pane } from "./Pane";

const kbd = "font-mono text-[11px] text-[#e4e4e7]";

/** Bytes a key sends to the shell, for send-prefix ("C-a" → \x01). */
function keyBytes(k: string): string {
  const ctrl = /^C-(.)$/.exec(k);
  if (ctrl) return String.fromCharCode(ctrl[1].toLowerCase().charCodeAt(0) & 0x1f);
  const meta = /^M-(.)$/.exec(k);
  if (meta) return "\x1b" + meta[1];
  return k.length === 1 ? k : "";
}

/** How to trigger an action, e.g. "⌃B %"; empty if nothing is bound. */
export function hint(km: TermKeymap | null, action: string): string {
  const b = km?.bindings.find((x) => x.action === action && !x.root) ?? km?.bindings.find((x) => x.action === action);
  if (!km || !b) return "";
  return b.root ? showKey(b.key) : `${showKey(km.prefix)} ${showKey(b.key)}`;
}

function elapsed(since: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function statusLook(s: TermInfo, now: number) {
  // The shell itself is gone, whatever its exit code: show it as dead.
  if (s.status === "exited") return { dot: "#f87171", meta: s.exitCode ? `exited ${s.exitCode}` : "exited", metaColor: "#f87171", dead: true };
  if (s.status === "running") return { dot: "#60a5fa", meta: elapsed(s.since, now), metaColor: "#93c5fd", dead: false };
  return { dot: "#52525b", meta: "idle", metaColor: "#a1a1aa", dead: false };
}

/** A hollow red ring for dead sessions, a filled dot otherwise. */
function StatusDot({ look, size = 7 }: { look: ReturnType<typeof statusLook>; size?: number }) {
  return (
    <span
      aria-hidden
      className="shrink-0 rounded-full"
      style={look.dead ? { width: size, height: size, boxShadow: `inset 0 0 0 1.5px ${look.dot}` } : { width: size, height: size, background: look.dot }}
    />
  );
}

export function Terminal() {
  const t = useTerminal();
  const { active, start, ready } = t;
  const [prefix, setPrefix] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => start(), [start]);

  // Prefix keys (⌃B or the tmux config's prefix, then a command key), plus
  // tmux "bind -n" keys. Captured on window before xterm sees them, and only
  // while this view is mounted.
  useEffect(() => {
    const km = t.keymap;
    if (!km) return;
    const stop = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const k = keyName(e);
      if (!k) return;
      if (!prefix) {
        if (k === km.prefix || (km.prefix2 && k === km.prefix2)) {
          stop(e);
          setPrefix(true);
          return;
        }
        const root = km.bindings.find((b) => b.root && b.key === k);
        if (root) {
          stop(e);
          run(root);
        }
        return;
      }
      stop(e);
      setPrefix(false);
      const b = km.bindings.find((x) => !x.root && x.key === k);
      if (b) run(b);
    };
    const run = (b: TermBinding) => {
      const moves: Record<string, L.Move> = { "focus-left": "left", "focus-right": "right", "focus-up": "up", "focus-down": "down" };
      if (moves[b.action]) return t.move(moves[b.action]);
      switch (b.action) {
        case "split-right":
          return void t.split("h");
        case "split-down":
          return void t.split("v");
        case "zoom":
          return t.toggleZoom();
        case "new-tab":
          return void t.newTab();
        case "close-pane":
          return t.closePane();
        case "close-tab":
          return t.closeTab();
        case "next-tab":
          return t.cycleTab(1);
        case "prev-tab":
          return t.cycleTab(-1);
        case "select-tab":
          return t.selectTabIndex(Number(b.arg) - km.baseIndex);
        case "background":
          return t.detachPane();
        case "break-pane":
          return t.breakPane();
        case "send-prefix":
          return t.sendToFocused(keyBytes(km.prefix));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [prefix, t]);

  const paneCount = active ? L.panes(active.root).length : 0;

  return (
    <div className="flex min-w-0 flex-1">
      <SessionsSidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Header paneCount={paneCount} />
        <main className="min-h-0 flex-1 bg-background">
          {!ready ? (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">Starting shell…</div>
          ) : active ? (
            active.zoom && L.findPane(active.root, active.zoom) ? (
              <Pane node={L.findPane(active.root, active.zoom)!} focused zoomed />
            ) : (
              <Tree node={active.root} focus={active.focus} />
            )
          ) : (
            <Empty />
          )}
        </main>
        {prefix ? <PrefixStrip onCancel={() => setPrefix(false)} /> : <StatusBar />}
      </div>
    </div>
  );
}

function Tree({ node, focus }: { node: L.LayoutNode; focus: string }) {
  const { setSizes } = useTerminal();
  if (node.kind === "pane") return <Pane node={node} focused={node.id === focus} zoomed={false} />;
  return (
    <PanelGroup direction={node.dir === "h" ? "horizontal" : "vertical"} onLayout={(sizes) => setSizes(node.id, sizes)}>
      {node.children.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 && (
            <PanelResizeHandle
              className={cn(
                "shrink-0 bg-background",
                node.dir === "h" ? "w-[5px] border-l border-border" : "h-[5px] border-t border-border",
                "data-[resize-handle-state=drag]:border-border-strong data-[resize-handle-state=hover]:border-border-strong",
              )}
            />
          )}
          <Panel id={c.id} order={i} defaultSize={node.sizes[i]} minSize={8}>
            <Tree node={c} focus={focus} />
          </Panel>
        </Fragment>
      ))}
    </PanelGroup>
  );
}

function Header({ paneCount }: { paneCount: number }) {
  const { tabs, active, selectTab, newTab, renameTab, split, toggleZoom, session, keymap, dragging, movePaneToTab, breakPane, setDragging } = useTerminal();
  const [dropTab, setDropTab] = useState("");
  // Panes dragged onto a tab move there; onto + they get a tab of their own.
  const dropProps = (id: string, onDrop: (pane: string) => void) =>
    dragging
      ? {
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropTab(id);
          },
          onDragLeave: () => setDropTab(""),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            setDropTab("");
            setDragging(null);
            onDrop(dragging);
          },
        }
      : {};
  const [editing, setEditing] = useState("");
  const iconBtn = "no-drag grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-[#141417] hover:text-strong disabled:opacity-40";

  return (
    <header className="drag flex min-h-12 items-stretch gap-1 border-b border-border pl-3 pr-2">
      <div role="tablist" aria-label="Terminal tabs" className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const on = tab.id === active?.id;
          const busy = !on && L.panes(tab.root).some((p) => session(p.sessionId)?.status === "running");
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={on}
              onClick={() => selectTab(tab.id)}
              onDoubleClick={() => setEditing(tab.id)}
              {...dropProps(tab.id, (p) => !on && movePaneToTab(p, tab.id))}
              className={cn(
                "no-drag inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3.5 text-[13px] font-medium",
                on ? "border-strong text-strong" : "border-transparent text-muted-foreground hover:text-strong",
                dropTab === tab.id && !on && "bg-[rgba(96,165,250,0.12)] text-strong",
              )}
            >
              {editing === tab.id ? (
                <input
                  autoFocus
                  defaultValue={tab.name}
                  aria-label="Tab name"
                  className="h-7 w-28 rounded border border-border-strong bg-transparent px-1.5 text-[13px] text-strong outline-none"
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    renameTab(tab.id, e.target.value);
                    setEditing("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditing("");
                  }}
                />
              ) : (
                tab.name
              )}
              {on && tab.zoom && (
                <span className="rounded bg-[rgba(251,191,36,0.14)] px-1.5 py-px text-[11px] text-[#fcd34d]">zoomed · 1 of {paneCount}</span>
              )}
              {on && !tab.zoom && paneCount > 1 && <span className="rounded bg-[#27272a] px-1.5 py-px text-[11px] text-muted-foreground">{paneCount} panes</span>}
              {busy && <span aria-label="Activity" className="size-1.5 rounded-full bg-[#60a5fa]" />}
            </button>
          );
        })}
        <Tooltip label={`New tab  ${hint(keymap, "new-tab")}`}>
          <button
            aria-label="New tab"
            className={cn(iconBtn, "self-center", dropTab === "+" && "bg-[rgba(96,165,250,0.12)] text-strong")}
            onClick={() => newTab()}
            {...dropProps("+", (p) => breakPane(p))}
          >
            <Plus className="size-4" strokeWidth={1.9} />
          </button>
        </Tooltip>
      </div>
      <div className="flex items-center gap-0.5">
        {active?.zoom ? (
          <button
            className="no-drag inline-flex h-8 items-center gap-2 rounded-md border border-border-strong px-2.5 text-xs text-[#e4e4e7] hover:text-strong"
            onClick={toggleZoom}
          >
            Restore splits<kbd className="font-mono text-[11px] text-muted-foreground">{hint(keymap, "zoom")}</kbd>
          </button>
        ) : (
          <>
            <Tooltip label={`Split right  ${hint(keymap, "split-right")}`}>
              <button aria-label="Split right" className={iconBtn} disabled={!active} onClick={() => split("h")}>
                <Columns2 className="size-[17px]" strokeWidth={1.8} />
              </button>
            </Tooltip>
            <Tooltip label={`Split down  ${hint(keymap, "split-down")}`}>
              <button aria-label="Split down" className={iconBtn} disabled={!active} onClick={() => split("v")}>
                <Rows2 className="size-[17px]" strokeWidth={1.8} />
              </button>
            </Tooltip>
            <Tooltip label={`Zoom pane  ${hint(keymap, "zoom")}`}>
              <button aria-label="Zoom pane" className={iconBtn} disabled={!active || paneCount < 2} onClick={toggleZoom}>
                <Maximize2 className="size-4" strokeWidth={1.8} />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </header>
  );
}

function SessionsSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { sessions, tabs, active, attach, newSession, endpoint, quickIds, openInTab } = useTerminal();
  const now = useNow();
  const home = endpoint?.home ?? "";
  const tilde = (p: string) => (home && p.startsWith(home) ? "~" + p.slice(home.length) : p);

  const inTab = new Set(active ? L.panes(active.root).map((p) => p.sessionId) : []);
  const inOtherTabs = new Set(tabs.filter((x) => x.id !== active?.id).flatMap((x) => L.panes(x.root).map((p) => p.sessionId)));
  const focusedSession = active && L.findPane(active.root, active.focus)?.sessionId;
  // Quick-terminal sessions get their own sections while their shell lives;
  // a dead one is replaced on the next ⌘/, so it isn't listed.
  const quickOf = new Map(Object.entries(quickIds).map(([k, id]) => [id, k]));
  const quickRows = (kind: string) => sessions.filter((s) => quickOf.get(s.id) === kind && s.status !== "exited" && !inTab.has(s.id) && !inOtherTabs.has(s.id));
  const elsewhere = (s: TermInfo) => !inTab.has(s.id) && !quickOf.has(s.id);
  const groups = [
    { label: "In this tab", rows: sessions.filter((s) => inTab.has(s.id)) },
    { label: "Other tabs", rows: sessions.filter((s) => elsewhere(s) && inOtherTabs.has(s.id)) },
    { label: "Quick terminal", rows: quickRows("home"), quick: true },
    { label: "Editor", rows: quickRows("posts"), quick: true },
    { label: "Background", rows: sessions.filter((s) => elsewhere(s) && !inOtherTabs.has(s.id)) },
  ].filter((g) => g.rows.length || g.label === "In this tab");

  if (collapsed) {
    return (
      <aside aria-label="Sessions" className="flex w-[52px] shrink-0 flex-col items-center gap-2 border-r border-border pt-1">
        <Tooltip label="Show sessions" side="right">
          <button aria-label="Show sessions" className="no-drag grid size-10 place-items-center rounded-md text-muted-foreground hover:text-strong" onClick={onToggle}>
            <PanelLeftOpen className="size-4" strokeWidth={1.8} />
          </button>
        </Tooltip>
        {sessions.map((s) => {
          const look = statusLook(s, now);
          return (
            <Tooltip key={s.id} label={`${s.name} · ${look.meta}`} side="right">
              <button aria-label={s.name} className={cn("grid size-8 place-items-center rounded-md hover:bg-[#18181b]", s.id === focusedSession && "bg-[#18181b]")} onClick={() => attach(s.id)}>
                <StatusDot look={look} />
              </button>
            </Tooltip>
          );
        })}
      </aside>
    );
  }

  return (
    <aside aria-label="Sessions" className="flex w-[248px] shrink-0 flex-col border-r border-border">
      <div className="drag flex h-12 shrink-0 items-center justify-between border-b border-border pl-4 pr-1">
        <h2 className="text-sm font-semibold text-strong">Sessions</h2>
        <div className="flex">
          <Tooltip label="New background session">
            <button aria-label="New session" className="no-drag grid size-10 place-items-center rounded-md text-muted-foreground hover:text-strong" onClick={() => newSession()}>
              <Plus className="size-[18px]" strokeWidth={1.9} />
            </button>
          </Tooltip>
          <Tooltip label="Collapse">
            <button aria-label="Collapse sessions" className="no-drag grid size-10 place-items-center rounded-md text-muted-foreground hover:text-strong" onClick={onToggle}>
              <PanelLeftClose className="size-4" strokeWidth={1.8} />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3 pt-2">
        {groups.map((g, gi) => (
          <Fragment key={g.label}>
            <div className={cn("px-2 pb-1.5 text-[11px] font-medium uppercase tracking-[.06em] text-muted-foreground", gi === 0 ? "pt-2" : "pt-4")}>
              {g.label} · {g.rows.length}
            </div>
            {g.rows.map((s) => {
              const look = statusLook(s, now);
              const sub = s.status === "running" ? s.process : `${s.shell} · ${tilde(s.cwd)}`;
              return (
                <button
                  key={s.id}
                  onClick={() => ("quick" in g ? openInTab(s.id) : attach(s.id))}
                  title={"quick" in g ? "Open in a new tab (⌘/ shows it over the other views)" : g.label === "Background" ? "Attach to the focused pane" : undefined}
                  className={cn(
                    "flex w-full flex-col items-start gap-1 rounded-lg px-2.5 py-[9px] text-left hover:bg-[#141417]",
                    s.id === focusedSession && "bg-[#18181b] shadow-[inset_0_0_0_1px_#27272a]",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <StatusDot look={look} />
                    <span className={cn("flex-1 truncate text-[13px] font-medium", g.label === "In this tab" ? "text-strong" : "text-[#e4e4e7]")}>{s.name}</span>
                    <span className="font-mono text-[11px]" style={{ color: look.metaColor }}>
                      {look.meta}
                    </span>
                  </span>
                  <span className="w-full truncate pl-[15px] font-mono text-xs text-muted-foreground">{sub}</span>
                </button>
              );
            })}
            {!g.rows.length && <div className="px-2.5 py-1 text-xs text-dim-2">None</div>}
          </Fragment>
        ))}
      </div>
      <div className="flex items-start gap-2.5 border-t border-border px-4 py-3 text-xs leading-[1.45] text-muted-foreground">
        <Info className="mt-px size-[15px] shrink-0" strokeWidth={1.9} />
        <span>Sessions keep running when you switch views. They end when Relay quits.</span>
      </div>
    </aside>
  );
}

function StatusBar() {
  const { sessions, active, session, keymap } = useTerminal();
  const running = sessions.filter((s) => s.status === "running").length;
  const focused = active && L.findPane(active.root, active.focus);
  const name = focused && session(focused.sessionId)?.name;
  return (
    <footer className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border px-4 py-1.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <kbd className="rounded border border-border-strong px-1.5 py-px font-mono text-[#e4e4e7]">{showKey(keymap?.prefix ?? "C-b")}</kbd>prefix
      </span>
      {keymap?.source && (
        <span title={keymap.skipped.length ? `Not supported:\n${keymap.skipped.join("\n")}` : undefined}>
          keys from {keymap.source.replace(/^.*\/(\.config\/tmux\/)?/, "")}
          {keymap.skipped.length > 0 && ` · ${keymap.skipped.length} skipped`}
        </span>
      )}
      <span className="flex-1" />
      <span>
        {sessions.length} {sessions.length === 1 ? "session" : "sessions"} · {running} running
      </span>
      {name && <span>Focused: {name}</span>}
    </footer>
  );
}

const stripActions: [string, string][] = [
  ["split-right", "split right"],
  ["split-down", "split down"],
  ["focus", "focus"],
  ["zoom", "zoom"],
  ["background", "send to background"],
  ["new-tab", "new tab"],
  ["next-tab", "next tab"],
  ["break-pane", "own tab"],
  ["close-pane", "close pane"],
  ["send-prefix", "send prefix"],
];

function PrefixStrip({ onCancel }: { onCancel: () => void }) {
  const { keymap } = useTerminal();
  const keysFor = (action: string) => {
    const bs = keymap?.bindings.filter((b) => !b.root && (action === "focus" ? b.action.startsWith("focus-") : b.action === action)) ?? [];
    return bs.map((b) => showKey(b.key)).join(action === "focus" ? "" : " ");
  };
  return (
    <>
      <div
        role="status"
        aria-label="Prefix mode"
        className="absolute bottom-6 left-1/2 z-20 flex w-[min(1040px,calc(100%-32px))] -translate-x-1/2 flex-wrap items-center gap-x-1.5 gap-y-2 rounded-[10px] border border-border-strong bg-[#111113] px-3 py-2.5 text-xs shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
      >
        <span className="mr-1 inline-flex items-center gap-2 font-medium text-strong">
          <kbd className="rounded border border-border-strong px-1.5 py-px font-mono">{showKey(keymap?.prefix ?? "C-b")}</kbd>
        </span>
        {stripActions.map(([action, label]) => {
          const k = keysFor(action);
          return (
            k && (
              <span key={action} className="inline-flex h-[26px] items-center gap-1.5 rounded-md px-2 text-muted-foreground">
                <kbd className={cn(kbd, "text-strong")}>{k}</kbd>
                {label}
              </span>
            )
          );
        })}
        <span className="flex-1" />
        <button className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground hover:text-strong" onClick={onCancel}>
          <kbd className={kbd}>esc</kbd>cancel
        </button>
      </div>
      <StatusBar />
    </>
  );
}

function Empty() {
  const { newTab } = useTerminal();
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-3 text-xs text-muted-foreground">
        <SquareTerminal className="size-6" strokeWidth={1.6} />
        <span>No open panes. Background sessions are in the sidebar.</span>
        <button className="h-8 rounded-md bg-strong px-3 text-xs font-medium text-background" onClick={() => newTab()}>
          New tab
        </button>
      </div>
    </div>
  );
}
