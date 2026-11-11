import { useEffect, useState } from "react";
import { Bell, CalendarDays, Kanban, Lock, LockOpen, PanelLeftClose, PanelLeftOpen, PenLine, RefreshCw, SlidersHorizontal, SquareTerminal } from "lucide-react";
import { BufferLogo } from "@/components/icons/BufferLogo";
import { usePlane } from "@/lib/store";
import { useIntegrations } from "@/lib/integrations";
import { useTerminal } from "@/lib/terminal";
import { attentionRows, boardsOn, openCount } from "@/lib/plane";
import { syncedAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Dot, PrivateLock, ProjectGlyph } from "@/components/bits";
import { Tooltip } from "@/components/ui/tooltip";
import { NotificationsButton } from "@/components/Notifications";
import type { Route } from "@/App";

function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function Sidebar({ route, go, rail, onToggle }: { route: Route; go: (r: Route) => void; rail: boolean; onToggle: () => void }) {
  const { projects, snapshot, syncing, syncNow, readOnly, lock } = usePlane();
  // With the Buffer board listed beside Plane's, each board says where it lives.
  const mixed = projects.some((p) => p.source === "buffer") && projects.some((p) => p.source !== "buffer");
  const planeOn = boardsOn(snapshot);
  const { buffer, devto } = useIntegrations();
  // Unknown counts as on, so nothing jumps sections while loading.
  const bufferOn = buffer !== false;
  const others = [
    !snapshot?.connected && { label: "Plane", icon: <Kanban className="size-[15px]" strokeWidth={1.8} />, onClick: () => go({ name: "settings", tab: "plane" }), active: false },
    !bufferOn && { label: "Buffer", icon: <BufferLogo className="size-[14px]" />, onClick: () => go({ name: "buffer" }), active: route.name === "buffer" },
    devto === false && { label: "Dev.to", icon: <PenLine className="size-[15px]" strokeWidth={1.8} />, onClick: () => go({ name: "settings", tab: "publishing" }), active: false },
  ].filter((o) => !!o);
  const anyUnlocked = projects.some((p) => (p.private && !p.locked) || p.modules.some((m) => m.private && !m.locked));
  const { sessions } = useTerminal();
  // Blue dot on the Terminal entry while a session runs out of view.
  const termBusy = route.name !== "terminal" && sessions.some((s) => s.status === "running");
  const now = useNow(1000);
  const attention = attentionRows(projects).length;
  const synced = snapshot?.syncedAt && !snapshot.syncedAt.startsWith("0001") ? snapshot.syncedAt : "";
  const syncLabel = !planeOn
    ? "Plane not connected"
    : readOnly
      ? snapshot?.error
        ? "Saved data · sync failed"
        : "Saved data · syncing…"
      : syncing
      ? "Syncing…"
      : synced
        ? `Synced ${syncedAgo(synced, now)}`
        : "Not synced yet";
  const syncColor = !planeOn ? "#71717a" : snapshot?.error || snapshot?.bufferPlanError ? "#ef4444" : readOnly ? "#f59e0b" : "#46a758";

  const item = (active: boolean, extra?: string) =>
    cn(
      "no-drag flex min-h-[34px] items-center gap-2.5 rounded-md px-2.5 text-muted-foreground hover:bg-[#141417] hover:text-strong",
      active && "bg-[#1a1a1e] text-strong",
      rail && "w-11 justify-center px-0",
      extra,
    );

  const Item = ({
    active,
    onClick,
    icon,
    label,
    badge,
    dot,
    title,
  }: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    badge?: React.ReactNode;
    dot?: boolean;
    title?: string;
  }) => {
    const btn = (
      <button
        className={cn(item(active), "relative")}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        aria-label={rail ? label : undefined}
        title={!rail ? title : undefined}
      >
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
        {rail ? (
          <Tooltip label="Expand sidebar  ⌘\" side="right">
            <button aria-label="Expand sidebar" onClick={onToggle} className="no-drag group/mark relative grid size-6 place-items-center rounded-md">
              <img src="/relay-mark.svg" alt="" className="block size-6 shrink-0 group-hover/mark:opacity-0 group-focus-visible/mark:opacity-0" draggable={false} />
              <PanelLeftOpen className="absolute size-[15px] text-strong opacity-0 group-hover/mark:opacity-100 group-focus-visible/mark:opacity-100" strokeWidth={1.8} />
            </button>
          </Tooltip>
        ) : (
          <img src="/relay-mark.svg" alt="" className="block size-6 shrink-0" draggable={false} />
        )}
        {!rail && <span>Relay</span>}
        {!rail && (
          <Tooltip label="Collapse sidebar  ⌘\">
            <button
              aria-label="Collapse sidebar"
              onClick={onToggle}
              className="no-drag ml-auto grid size-7 place-items-center rounded-md text-dim hover:bg-[#1c1c20] hover:text-strong focus-visible:outline focus-visible:outline-1 focus-visible:outline-border-strong"
            >
              <PanelLeftClose className="size-[15px]" strokeWidth={1.8} />
            </button>
          </Tooltip>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {planeOn && (
          <Item
            active={route.name === "attention"}
            onClick={() => go({ name: "attention" })}
            icon={<Bell className="size-[15px]" strokeWidth={1.8} />}
            label="Attention"
            badge={attention > 0 && <span className="ml-auto rounded-full bg-[#4a1d35] px-[7px] py-px text-[11px] text-[#fbcfe8]">{attention}</span>}
          />
        )}
        <Item
          active={route.name === "timeline"}
          onClick={() => go({ name: "timeline" })}
          icon={<CalendarDays className="size-[15px]" strokeWidth={1.8} />}
          label="Timeline"
          title="Buffer posts, Dev.to articles and Plane due dates by day  (L)"
        />
      </div>

      {planeOn && (
        <>

          <div className="flex flex-col gap-0.5">
            <SectionTitle rail={rail}>{snapshot?.connected && !mixed ? "Plane projects" : "Projects"}</SectionTitle>
            {projects.map((p) => (
              <Item
                key={p.id}
                active={route.name === "project" && route.projectId === p.id}
                onClick={() => go({ name: "project", projectId: p.id })}
                icon={mixed ? <SourceGlyph project={p} /> : <ProjectGlyph project={p} />}
                label={p.source === "buffer" ? `${p.name} (experimental)` : p.name}
                title={mixed ? (p.source === "buffer" ? "Board in Buffer" : "Project in Plane") : undefined}
                badge={
                  <span className="ml-auto text-[11px] text-dim" title={p.private ? (p.locked ? "Locked: unlock to see items" : "Unlocked: locks again automatically") : undefined}>
                    {p.private ? p.locked ? <PrivateLock /> : <LockOpen className="size-[13px] text-[#5eead4]" strokeWidth={1.9} aria-label="Unlocked" /> : openCount(p)}
                  </span>
                }
              />
            ))}
            {!rail && projects.length === 0 && <span className="px-2.5 text-xs text-dim">Loading projects…</span>}
          </div>
        </>
      )}

      <div className="flex flex-col gap-0.5">
        <SectionTitle rail={rail}>Write</SectionTitle>
        <Item active={route.name === "editor"} onClick={() => go({ name: "editor" })} icon={<PenLine className="size-[15px]" strokeWidth={1.8} />} label="Posts" title="Write and publish Dev.to articles  (E)" />
        {bufferOn && (
          <Item active={route.name === "buffer"} onClick={() => go({ name: "buffer" })} icon={<BufferLogo className="size-[14px]" />} label="Buffer" />
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <SectionTitle rail={rail}>Run</SectionTitle>
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

      {others.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <SectionTitle rail={rail}>Other integrations</SectionTitle>
          {others.map((o) => (
            <Item key={o.label} active={o.active} onClick={o.onClick} icon={o.icon} label={o.label} badge={<span className="ml-auto text-[11px] text-dim">Set up</span>} />
          ))}
        </div>
      )}

      {!planeOn ? null : rail ? (
        <Tooltip label={syncLabel} side="right">
          <button aria-label="Sync now" className={item(false)} onClick={syncNow}>
            <RefreshCw className={cn("size-[15px]", syncing && "animate-spin")} strokeWidth={1.8} />
          </button>
        </Tooltip>
      ) : (
        <div className="flex min-h-[34px] items-center gap-2 pl-2.5 text-xs text-dim" title={snapshot?.error || undefined}>
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
      <NotificationsButton rail={rail} itemClass={item(false)} />
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

/** The project's glyph with a small mark in the corner for where it lives:
 * Plane's board icon or Buffer's logo. */
function SourceGlyph({ project }: { project: Parameters<typeof ProjectGlyph>[0]["project"] & { source: string } }) {
  const buffer = project.source === "buffer";
  return (
    <span className="relative inline-flex shrink-0">
      <ProjectGlyph project={project} />
      <span
        aria-label={buffer ? "Buffer" : "Plane"}
        className="absolute -bottom-1 -right-1 grid size-[13px] place-items-center rounded-full border border-[#0b0b0d] bg-[#232328] text-[#d4d4d8]"
      >
        {buffer ? <BufferLogo className="size-[8px]" /> : <Kanban className="size-[8px]" strokeWidth={2.4} />}
      </span>
    </span>
  );
}

/** A section's title; in the rail, a short rule of the same height, so items
 * sit at the same place whether the sidebar is expanded or not. */
function SectionTitle({ rail, children }: { rail: boolean; children: React.ReactNode }) {
  return rail ? (
    <div aria-hidden className="flex h-6 items-center justify-center">
      <span className="h-px w-5 bg-[#232328]" />
    </div>
  ) : (
    <div className="flex h-6 items-center px-2.5 text-[11px] font-medium uppercase tracking-[.06em] text-dim">{children}</div>
  );
}
