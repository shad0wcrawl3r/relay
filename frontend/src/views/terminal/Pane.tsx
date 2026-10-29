import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Browser } from "@wailsio/runtime";
import { X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { TerminalService } from "@/lib/api";
import { useTerminal } from "@/lib/terminal";
import type { Edge, PaneNode } from "@/lib/layout";
import { cn } from "@/lib/utils";

// design/README.md §4 "Terminal" tokens; ANSI colours from the same palette.
const theme: ITheme = {
  background: "#0c0c0e",
  foreground: "#e4e4e7",
  cursor: "#e4e4e7",
  cursorAccent: "#0c0c0e",
  selectionBackground: "rgba(255, 255, 255, 0.18)",
  black: "#18181b",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c4b5fd",
  cyan: "#67e8f9",
  white: "#d4d4d8",
  brightBlack: "#52525b",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fcd34d",
  brightBlue: "#93c5fd",
  brightMagenta: "#ddd6fe",
  brightCyan: "#a5f3fc",
  brightWhite: "#fafafa",
};

// Nerd Font symbols (bundled, see index.css) fill in prompt icons the text
// font lacks.
const FONT = '"JetBrains Mono Variable", "Symbols Nerd Font Mono", ui-monospace, monospace';
const enc = new TextEncoder();

type Ended = { code: number } | "gone" | null;

/** Outside the tab layout (quick terminal): no pane header, focus or drag;
 *  close and restart go to the owner. */
export interface Detached {
  onClose: () => void;
  onRestart: () => void;
}

export function Pane({ node, focused, zoomed, detached }: { node: PaneNode; focused: boolean; zoomed: boolean; detached?: Detached }) {
  const store = useTerminal();
  const { endpoint, session, register, movePane } = store;
  const focusPane = detached ? () => {} : store.focusPane;
  const closePane = detached ? () => detached.onClose() : store.closePane;
  const restart = detached ? async () => detached.onRestart() : store.restart;
  const dragging = detached ? null : store.dragging;
  const setDragging = store.setDragging;
  const [edge, setEdge] = useState<Edge | null>(null);
  const info = session(node.sessionId);
  const host = useRef<HTMLDivElement>(null);
  const [ended, setEnded] = useState<Ended>(null);
  const [renaming, setRenaming] = useState(false);
  // Callbacks read the latest props without re-creating the terminal.
  const latest = useRef({ ended, restart, focusPane, paneId: node.id });
  latest.current = { ended, restart, focusPane, paneId: node.id };
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  useEffect(() => {
    const el = host.current;
    if (!el || !endpoint) return;
    let disposed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setEnded(null);

    const term = new XTerm({
      fontFamily: FONT,
      fontSize: 13,
      lineHeight: 1.45,
      theme,
      scrollback: 10000,
      cursorBlink: true,
      allowProposedApi: true,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, uri) => void Browser.OpenURL(uri)));

    let sent = { cols: 0, rows: 0 };
    const sync = () => {
      if (disposed || !el.offsetWidth || !el.offsetHeight) return;
      fit.fit();
      if (term.cols !== sent.cols || term.rows !== sent.rows) {
        sent = { cols: term.cols, rows: term.rows };
        TerminalService.Resize(node.sessionId, term.cols, term.rows).catch(() => {});
      }
    };

    const connect = () => {
      const sock = new WebSocket(`${endpoint.url}/term/${encodeURIComponent(node.sessionId)}?token=${endpoint.token}`);
      sock.binaryType = "arraybuffer";
      let opened = false;
      sock.onopen = () => {
        opened = true;
        sent = { cols: 0, rows: 0 };
        sync();
      };
      sock.onmessage = (ev) => term.write(new Uint8Array(ev.data as ArrayBuffer));
      sock.onclose = (ev) => {
        if (disposed) return;
        const exit = /^exit (-?\d+)$/.exec(ev.reason);
        if (exit) {
          const code = Number(exit[1]);
          setEnded({ code });
          term.write(`\r\n\x1b[2m[process exited${code ? ` with code ${code}` : ""} · ⏎ restart · ⌃B x close]\x1b[0m\r\n`);
        } else if (opened) {
          // Dropped, e.g. too slow to keep up: reattach for a fresh snapshot.
          retry = setTimeout(() => !disposed && (ws = connect()), 200);
        } else {
          // Refused before opening: the session no longer exists.
          setEnded("gone");
        }
      };
      return sock;
    };

    const send = (data: string | Uint8Array) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(typeof data === "string" ? enc.encode(data) : data);
    };

    term.onData((d) => {
      if (latest.current.ended) {
        if (d === "\r") latest.current.restart(latest.current.paneId);
        return;
      }
      send(d);
    });
    term.onBinary((d) => send(Uint8Array.from(d, (c) => c.charCodeAt(0) & 0xff)));

    const ro = new ResizeObserver(() => requestAnimationFrame(sync));
    // Measure with the real font, or cell size (and so cols/rows) is wrong.
    Promise.allSettled([document.fonts.load(`13px "JetBrains Mono Variable"`), document.fonts.load(`13px "Symbols Nerd Font Mono"`, "\ue0b0")]).finally(() => {
      if (disposed) return;
      term.open(el);
      term.textarea?.addEventListener("focus", () => latest.current.focusPane(latest.current.paneId));
      sync();
      ro.observe(el);
      ws = connect();
      register(node.id, { send, focus: () => term.focus() });
      if (focusedRef.current) term.focus();
    });

    return () => {
      disposed = true;
      clearTimeout(retry);
      ro.disconnect();
      register(node.id, null);
      ws?.close();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.sessionId, node.id, endpoint]);

  const proc = info?.status === "running" ? info.process : info?.shell;

  return (
    <section
      aria-label={`Pane: ${info?.name ?? "session"}`}
      className={cn("flex h-full min-w-0 flex-col bg-[#0c0c0e]", focused && !zoomed && "shadow-[inset_0_0_0_1px_#3f3f46]")}
      onMouseDown={() => focusPane(node.id)}
    >
      {!detached && (
      <div
        draggable={!renaming && !zoomed}
        title={zoomed ? undefined : "Drag to move this pane"}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-relay-pane", node.id);
          e.dataTransfer.effectAllowed = "move";
          // Let the drag image render before panes grow drop overlays.
          setTimeout(() => setDragging(node.id));
        }}
        onDragEnd={() => setDragging(null)}
        className={cn(
          "flex h-9 shrink-0 cursor-grab items-center border-b border-hairline pr-0.5 active:cursor-grabbing",
          focused ? "bg-[#18181b] text-strong" : "bg-[#0c0c0e] text-muted-foreground",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-xs" onDoubleClick={() => setRenaming(true)}>
          {renaming ? (
            <input
              autoFocus
              defaultValue={info?.name}
              aria-label="Session name"
              className="h-6 w-40 rounded border border-border-strong bg-transparent px-1.5 text-xs text-strong outline-none"
              onBlur={(e) => {
                setRenaming(false);
                if (e.target.value.trim()) TerminalService.Rename(node.sessionId, e.target.value).catch(() => {});
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <span className="truncate font-semibold" title="Double-click to rename">
              {info?.name ?? "session"}
            </span>
          )}
          {proc && <span className="truncate font-mono text-muted-foreground">{proc}</span>}
          {info?.status === "exited" && (
            <span className="ml-1 inline-flex h-[22px] items-center gap-1.5 rounded bg-[rgba(248,113,113,0.14)] px-2 text-[11px] font-medium text-[#fca5a5]">
              exited{info.exitCode ? ` ${info.exitCode}` : ""}
            </span>
          )}
          {info?.altScreen && (
            <span className="ml-1 inline-flex h-[22px] items-center rounded bg-[#27272a] px-2 text-[11px] text-[#d4d4d8]">full-screen app</span>
          )}
        </div>
        <button
          aria-label="Close pane"
          title="Close pane (⌃B x)"
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-[#1c1c20] hover:text-strong"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => closePane(node.id)}
        >
          <X className="size-[13px]" strokeWidth={2} />
        </button>
      </div>
      )}
      <div className="relative min-h-0 flex-1 py-1.5 pl-3 pr-1">
        <div ref={host} className="size-full" />
        {dragging && dragging !== node.id && (
          <div
            className="absolute inset-0 z-10"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setEdge(edgeAt(e));
            }}
            onDragLeave={() => setEdge(null)}
            onDrop={(e) => {
              e.preventDefault();
              const at = edgeAt(e);
              setEdge(null);
              setDragging(null);
              movePane(dragging, node.id, at);
            }}
          >
            {edge && <div className="pointer-events-none absolute rounded-md border border-[#60a5fa] bg-[rgba(96,165,250,0.12)]" style={zoneStyle[edge]} />}
          </div>
        )}
        {ended === "gone" && (
          <div className="absolute inset-0 grid place-items-center bg-[#0c0c0e]/90 text-xs text-muted-foreground">
            <div className="flex flex-col items-center gap-3">
              <span>This session has ended.</span>
              <div className="flex gap-2">
                <button className="h-8 rounded-md bg-strong px-3 font-medium text-background" onClick={() => restart(node.id)}>
                  Start a new shell here
                </button>
                <button className="h-8 rounded-md border border-border px-3 hover:text-strong" onClick={() => closePane(node.id)}>
                  Close pane
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Which part of the pane the pointer is over: outer quarters split, the
 *  middle swaps. */
function edgeAt(e: React.DragEvent): Edge {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  const d = { left: x, right: 1 - x, top: y, bottom: 1 - y };
  const [side, dist] = Object.entries(d).sort((a, b) => a[1] - b[1])[0] as [Edge, number];
  return dist < 0.25 ? side : "center";
}

const zoneStyle: Record<Edge, React.CSSProperties> = {
  left: { inset: "4px 50% 4px 4px" },
  right: { inset: "4px 4px 4px 50%" },
  top: { inset: "4px 4px 50% 4px" },
  bottom: { inset: "50% 4px 4px 4px" },
  center: { inset: "4px" },
};
