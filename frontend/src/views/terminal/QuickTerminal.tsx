import { useEffect, useState } from "react";
import { ArrowUpRight, Loader2, SquareTerminal, X } from "lucide-react";
import { SettingsService, TerminalService } from "@/lib/api";
import { useTerminal, type QuickKind } from "@/lib/terminal";
import type { PaneNode } from "@/lib/layout";
import { errorMessage } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { Pane } from "./Pane";

const MIN = 180;

/**
 * ⌘/ terminal over the Plane and editor views. Its session keeps running when
 * the panel closes, and comes back next time while the shell is alive.
 */
export function QuickTerminal({ kind, left, onClose, onOpenInTerminal }: { kind: QuickKind; left: number; onClose: () => void; onOpenInTerminal: () => void }) {
  const { endpoint, session, quickSession, openInTab } = useTerminal();
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState("");
  const [height, setHeight] = useState(() => Math.round(window.innerHeight * 0.42));

  const open = async () => {
    setError("");
    try {
      const cwd = kind === "posts" ? (await SettingsService.Get()).postsDir : (endpoint?.home ?? "");
      setSessionId(await quickSession(kind, cwd));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  useEffect(() => {
    void open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const info = session(sessionId);
  const home = endpoint?.home ?? "";
  const cwd = info?.cwd && home && info.cwd.startsWith(home) ? "~" + info.cwd.slice(home.length) : info?.cwd;
  const node: PaneNode = { kind: "pane", id: `quick-${sessionId}`, sessionId };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev: PointerEvent) => setHeight(Math.max(MIN, Math.min(window.innerHeight - 80, startH + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      role="region"
      aria-label="Quick terminal"
      className="fixed bottom-0 right-0 z-40 flex flex-col border-t border-border-strong bg-[#0c0c0e] shadow-[0_-12px_32px_rgba(0,0,0,0.45)]"
      style={{ left, height }}
    >
      <div aria-hidden className="absolute inset-x-0 -top-1 h-2 cursor-row-resize" onPointerDown={startResize} />
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-hairline bg-[#111113] pl-3 pr-1 text-xs">
        <SquareTerminal className="size-3.5 text-muted-foreground" strokeWidth={1.9} />
        <span className="font-semibold text-strong">Quick terminal</span>
        {info && (
          <span className="truncate font-mono text-muted-foreground">
            {info.name} · {info.status === "running" ? info.process : cwd}
          </span>
        )}
        <span className="flex-1" />
        <kbd className="mr-1 font-mono text-[11px] text-dim">⌘/ to hide</kbd>
        <Tooltip label="Open in the Terminal view">
          <button
            aria-label="Open in Terminal"
            disabled={!sessionId}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-[#1c1c20] hover:text-strong disabled:opacity-40"
            onClick={() => {
              openInTab(sessionId);
              onOpenInTerminal();
            }}
          >
            <ArrowUpRight className="size-3.5" strokeWidth={2} />
            Terminal
          </button>
        </Tooltip>
        <button aria-label="Hide quick terminal" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-[#1c1c20] hover:text-strong" onClick={onClose}>
          <X className="size-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="grid h-full place-items-center text-xs text-[#fca5a5]">{error}</div>
        ) : sessionId && endpoint ? (
          <Pane
            key={sessionId}
            node={node}
            focused
            zoomed
            detached={{
              onClose: () => {
                TerminalService.Kill(sessionId).catch(() => {});
                onClose();
              },
              onRestart: () => void open(),
            }}
          />
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
