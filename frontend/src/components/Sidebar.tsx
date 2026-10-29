import { useEffect, useState } from "react";
import { Bell, Lock, LockOpen, PenLine, RefreshCw, SlidersHorizontal, SquareTerminal } from "lucide-react";
import { usePlane } from "@/lib/store";
import { useTerminal } from "@/lib/terminal";
import { attentionRows, openCount } from "@/lib/plane";
import { syncedAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Dot, PrivateLock, ProjectGlyph } from "@/components/bits";
import { Tooltip } from "@/components/ui/tooltip";
import type { Route } from "@/App";

function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function Sidebar({ route, go, rail }: { route: Route; go: (r: Route) => void; rail: boolean }) {
  const { projects, snapshot, syncing, syncNow, readOnly, lock } = usePlane();
  const anyUnlocked = projects.some((p) => (p.private && !p.locked) || p.modules.some((m) => m.private && !m.locked));
  const { sessions } = useTerminal();
  // Blue dot on the Terminal entry while a session runs out of view.
  const termBusy = route.name !== "terminal" && sessions.some((s) => s.status === "running");
  const now = useNow(1000);
  const attention = attentionRows(projects).length;
  const synced = snapshot?.syncedAt && !snapshot.syncedAt.startsWith("0001") ? snapshot.syncedAt : "";
  const syncLabel = !snapshot?.connected
    ? "Plane not connected"
    : readOnly
      ? snapshot.error
        ? "Saved data · sync failed"
        : "Saved data · syncing…"
      : syncing
      ? "Syncing…"
      : synced
        ? `Synced ${syncedAgo(synced, now)}`
        : "Not synced yet";
  const syncColor = !snapshot?.connected ? "#71717a" : snapshot.error ? "#ef4444" : readOnly ? "#f59e0b" : "#46a758";

  const item = (active: boolean, extra?: string) =>
    cn(
      "no-drag flex min-h-[34px] items-center gap-2.5 rounded-md px-2.5 text-muted-foreground hover:bg-[#141417] hover:text-strong",
      active && "bg-[#1a1a1e] text-strong",
      rail && "size-11 justify-center px-0",
      extra,
    );

  const Item = ({
    active,
    onClick,
    icon,
    label,
    badge,
    dot,
  }: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    badge?: React.ReactNode;
    dot?: boolean;
  }) => {
    const btn = (
      <button className={cn(item(active), "relative")} onClick={onClick} aria-current={active ? "page" : undefined} aria-label={rail ? label : undefined}>
        {icon}
        {rail && dot && <span aria-hidden className="absolute right-2 top-2 size-1.5 rounded-full bg-[#60a5fa]" />}
        {!rail && <span className="truncate">{label}</span>}
        {!rail && badge}
      </button>
    );
    return rail ? (
      <Tooltip label={label} side="right">
        {btn}
      </Tooltip>
    ) : (
      btn
    );
  };

  return (
    <nav
      aria-label="Main"
      className={cn(
        "drag flex shrink-0 flex-col gap-5 border-r border-hairline bg-sidebar pb-3.5 pt-10 transition-[width] duration-150",
        rail ? "w-14 items-center px-1.5" : "w-[220px] px-2.5",
      )}
    >
      {/* Same left edge as the nav icons below (nav px-2.5 + item px-2.5). */}
      <div className={cn("flex h-6 items-center gap-2.5 text-sm font-semibold text-strong", rail ? "justify-center" : "px-2.5")}>
        <img src="/relay-mark.svg" alt="" className="block size-6 shrink-0" draggable={false} />
        {!rail && <span>Relay</span>}
      </div>

      <div className="flex flex-col gap-0.5">
        <Item
          active={route.name === "attention"}
          onClick={() => go({ name: "attention" })}
          icon={<Bell className="size-[15px]" strokeWidth={1.8} />}
          label="Attention"
          badge={attention > 0 && <span className="ml-auto rounded-full bg-[#4a1d35] px-[7px] py-px text-[11px] text-[#fbcfe8]">{attention}</span>}
        />
      </div>

      <div className="flex flex-col gap-0.5">
        {!rail && <div className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-[.06em] text-dim">Plane projects</div>}
        {projects.map((p) => (
          <Item
            key={p.id}
            active={route.name === "project" && route.projectId === p.id}
            onClick={() => go({ name: "project", projectId: p.id })}
            icon={<ProjectGlyph project={p} />}
            label={p.name}
            badge={
              <span className="ml-auto text-[11px] text-dim" title={p.private ? (p.locked ? "Locked: unlock to see items" : "Unlocked: locks again automatically") : undefined}>
                {p.private ? p.locked ? <PrivateLock /> : <LockOpen className="size-[13px] text-[#5eead4]" strokeWidth={1.9} aria-label="Unlocked" /> : openCount(p)}
              </span>
            }
          />
        ))}
        {!rail && projects.length === 0 && (
          <button className="no-drag px-2.5 text-left text-xs text-dim hover:text-strong" onClick={() => go({ name: "settings" })}>
            {snapshot?.connected ? "Loading projects…" : "Connect Plane in Settings"}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {!rail && <div className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-[.06em] text-dim">Write</div>}
        <Item active={route.name === "editor"} onClick={() => go({ name: "editor" })} icon={<PenLine className="size-[15px]" strokeWidth={1.8} />} label="Dev.to editor" />
      </div>

      <div className="flex flex-col gap-0.5">
        {!rail && <div className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-[.06em] text-dim">Run</div>}
        <Item
          active={route.name === "terminal"}
          onClick={() => go({ name: "terminal" })}
          icon={<SquareTerminal className="size-[15px]" strokeWidth={1.8} />}
          label="Terminal"
          dot={termBusy}
          badge={termBusy && <span aria-label="Sessions running" className="ml-auto size-1.5 rounded-full bg-[#60a5fa]" />}
        />
      </div>

      <div className="flex-1" />

      {rail ? (
        <Tooltip label={syncLabel} side="right">
          <button aria-label="Sync now" className={item(false)} onClick={syncNow}>
            <RefreshCw className={cn("size-[15px]", syncing && "animate-spin")} strokeWidth={1.8} />
          </button>
        </Tooltip>
      ) : (
        <div className="flex items-center gap-2 pl-2.5 text-xs text-dim" title={snapshot?.error || undefined}>
          <Dot color={syncColor} />
          <span className="truncate">{syncLabel}</span>
          <Tooltip label="Sync now  ⌘R">
            <button
              aria-label="Sync now"
              className="no-drag ml-auto grid size-[30px] place-items-center rounded-md text-muted-foreground hover:bg-[#1c1c20] hover:text-strong disabled:opacity-50"
              onClick={syncNow}
              disabled={!snapshot?.connected || syncing}
            >
              <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} strokeWidth={1.8} />
            </button>
          </Tooltip>
        </div>
      )}
      {anyUnlocked && (
        <Item active={false} onClick={() => lock()} icon={<Lock className="size-[15px] text-[#5eead4]" strokeWidth={1.8} />} label="Lock private items" />
      )}
      <Item
        active={route.name === "settings"}
        onClick={() => go({ name: "settings" })}
        icon={<SlidersHorizontal className="size-[15px]" strokeWidth={1.8} />}
        label="Settings"
      />
    </nav>
  );
}
