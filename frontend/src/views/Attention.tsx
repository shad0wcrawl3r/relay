import { useEffect, useMemo, useRef, useState } from "react";
import { usePlane } from "@/lib/store";
import { ATTENTION_GROUPS, attentionRows, boardsOn, findState, findStateByGroup, isOverdue, type AttentionRow } from "@/lib/plane";
import { ago, daysLate, duration, isoDate, shortDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Dot, PrivateLock, ProjectGlyph, StatePill } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { RescheduleButton } from "@/components/Reschedule";
import { ShipLogService, type Project, type ShipItem } from "@/lib/api";
import { NotebookPen } from "lucide-react";
import type { OpenItem } from "@/App";
import { EmptyState, Page } from "@/components/Page";

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function shelveState(p: Project) {
  return findState(p, "Shelved") ?? findStateByGroup(p, "cancelled") ?? findState(p, "Backlog") ?? findStateByGroup(p, "backlog");
}

function subtitle(r: AttentionRow): { text: string; over?: boolean } {
  const it = r.item;
  const comments = it.commentCount > 0 ? `${it.commentCount} comment${it.commentCount === 1 ? "" : "s"}` : "";
  switch (r.kind) {
    case "review":
      return { text: [it.agent ? "Agent report" : "Handed back", comments, ago(it.lastCommentAt || it.updatedAt)].filter(Boolean).join(" · ") };
    case "debate":
      return { text: it.lastCommentAt ? `Agent replied ${ago(it.lastCommentAt)} · your turn` : "Waiting for your reply" };
    case "blocked":
      return { text: `${r.state?.name ?? "Blocked"} · ${duration(it.updatedAt)}` };
    case "overdue": {
      const late = daysLate(it.targetDate);
      return { text: `Due ${shortDate(it.targetDate)} · ${late} day${late === 1 ? "" : "s"} late`, over: true };
    }
  }
}

export function Attention({
  openItem,
  goTimeline,
  goShipLog,
}: {
  openItem: (o: OpenItem) => void;
  goTimeline: () => void;
  /** Opens Ship with these items picked. */
  goShipLog: (itemIds: string[]) => void;
}) {
  const { projects, update, snapshot } = usePlane();
  // Finished this week, not written about yet (RELAY-125). Local data only.
  const [ready, setReady] = useState<ShipItem[]>([]);
  useEffect(() => {
    ShipLogService.ReadyToWrite().then(setReady, () => setReady([]));
  }, [snapshot]);
  const [filter, setFilter] = useState<string>("all");
  const rows = useMemo(() => attentionRows(projects), [projects]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.project.id === filter);
  const projectCount = new Set(rows.map((r) => r.project.id)).size;
  const hasPrivate = projects.some((p) => p.private);

  const move = (r: AttentionRow, stateNames: string[], groups: string[], verb: string) => {
    const s = findState(r.project, ...stateNames) ?? findStateByGroup(r.project, ...groups);
    if (!s) return;
    update(r.item, { stateId: s.id }, `${r.item.key} ${verb}`);
  };

  const actions = (r: AttentionRow) => {
    const open = { label: "Open", run: () => openItem({ projectId: r.project.id, itemId: r.item.id }) };
    switch (r.kind) {
      case "review":
        if (r.project.private) return [open];
        return [
          { label: "Done", run: () => move(r, ["Done"], ["completed"], "marked done") },
          { label: "Send back", run: () => move(r, ["Ready for Agent"], ["unstarted"], "sent back to the agent") },
          open,
        ];
      case "debate":
        return [
          { label: "Reply", run: () => openItem({ projectId: r.project.id, itemId: r.item.id, focusComposer: true }) },
          { label: "Approve", run: () => move(r, ["Approved"], ["started"], "approved") },
          {
            label: "Shelve",
            run: () => {
              const s = shelveState(r.project);
              if (s) update(r.item, { stateId: s.id }, `${r.item.key} shelved`);
            },
          },
        ];
      case "blocked":
        return [{ label: "Unblock", run: () => move(r, ["In Progress", "Building"], ["started"], "unblocked") }, open];
      case "overdue":
        return [{ label: "Reschedule", run: () => {} }, open];
    }
  };

  // Keyboard: J/K move through the rows in the order shown, ↵ opens, and
  // D / S / A run Done, Send back and Approve where the row offers them.
  const ordered = useMemo(() => ATTENTION_GROUPS.flatMap((g) => shown.filter((r) => r.kind === g.kind)), [shown]);
  const [cursor, setCursor] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const lastG = useRef(0);
  const live = useRef({ ordered, cursor, actions });
  live.current = { ordered, cursor, actions };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || document.querySelector("[role=dialog]")) return;
      const { ordered, cursor, actions } = live.current;
      if (ordered.length === 0) return;
      const i = ordered.findIndex((r) => r.item.id === cursor);
      const k = e.key.toLowerCase();
      // G then A is "go to Attention", not Approve.
      if (k === "g") lastG.current = Date.now();
      if (k === "a" && Date.now() - lastG.current < 1000) return;
      const moveTo = (n: number) => {
        const r = ordered[Math.max(0, Math.min(ordered.length - 1, n))];
        setCursor(r.item.id);
        rowRefs.current.get(r.item.id)?.scrollIntoView({ block: "nearest" });
      };
      if (k === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        moveTo(i < 0 ? 0 : i + 1);
        return;
      }
      if (k === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        moveTo(i < 0 ? 0 : i - 1);
        return;
      }
      if (i < 0) return;
      const row = ordered[i];
      const label = e.key === "Enter" ? (row.kind === "debate" ? "Reply" : "Open") : { d: "Done", s: "Send back", a: "Approve" }[k];
      const act = label && actions(row).find((a) => a.label === label);
      if (!act) return;
      e.preventDefault();
      // The row may leave the list; keep the cursor on the one after it.
      const next = ordered[i + 1] ?? ordered[i - 1];
      if (label !== "Open" && label !== "Reply") setCursor(next?.item.id ?? null);
      act.run();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <Page
      title="Attention"
      subtitle={
        !boardsOn(snapshot)
          ? "Connect Plane, or turn on planning in Buffer, in Settings to see what's waiting on you."
          : rows.length === 0
            ? "Nothing is waiting on you."
            : `${rows.length} item${rows.length === 1 ? "" : "s"} across ${projectCount} project${projectCount === 1 ? "" : "s"} ${rows.length === 1 ? "is" : "are"} waiting on you.`
      }
      actions={
          projects.length > 0 && (
            <div className="inline-flex rounded-[7px] border border-border bg-[#0f0f11] p-0.5" role="group" aria-label="Project filter">
              {[{ id: "all", name: "All" }, ...projects].map((p) => {
                const n = p.id === "all" ? rows.length : rows.filter((r) => r.project.id === p.id).length;
                return (
                  <button
                    key={p.id}
                    aria-pressed={filter === p.id}
                    onClick={() => setFilter(p.id)}
                    className={cn(
                      "inline-flex h-[26px] items-center gap-1.5 rounded-[5px] px-2.5 text-xs text-muted-foreground hover:text-strong",
                      filter === p.id && "bg-[#232328] text-strong",
                    )}
                  >
                    {p.name}
                    <span className="text-[11px] text-dim">{n}</span>
                  </button>
                );
              })}
            </div>
          )
      }
    >
        {boardsOn(snapshot) && rows.length === 0 && (
          <EmptyState title="You're clear." body="Reviews, debates, blocked and overdue items show up here as they happen." action={{ label: "Open Timeline", onClick: goTimeline }} />
        )}
        {ATTENTION_GROUPS.map((g) => {
          const groupRows = shown.filter((r) => r.kind === g.kind);
          if (groupRows.length === 0) return null;
          return (
            <section key={g.kind} className="mb-6" aria-label={g.name}>
              <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-[#d4d4d8]">
                <Dot color={g.color} />
                {g.name}
                <span className="font-normal text-dim">{groupRows.length}</span>
                {g.hint && <span className="ml-1 font-normal text-dim">· {g.hint}</span>}
              </div>
              <div className="overflow-hidden rounded-[10px] border border-column-border bg-column">
                {groupRows.map((r) => {
                  const sub = subtitle(r);
                  return (
                    <div
                      key={r.item.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(r.item.id, el);
                        else rowRefs.current.delete(r.item.id);
                      }}
                      aria-selected={cursor === r.item.id}
                      onPointerDown={() => setCursor(r.item.id)}
                      className={cn(
                        "flex items-center gap-3 border-b border-column-border px-3.5 py-2.5 last:border-b-0 hover:bg-[#121215]",
                        cursor === r.item.id && "bg-[#141418] shadow-[inset_2px_0_0_#a1a1aa]",
                      )}
                    >
                      <ProjectGlyph project={r.project} />
                      <span className="w-[76px] shrink-0 font-mono text-[11px] text-dim">{r.item.key}</span>
                      <button className="flex min-w-0 flex-1 flex-col gap-0.5 text-left" onClick={() => openItem({ projectId: r.project.id, itemId: r.item.id })}>
                        <span className="flex items-center gap-1.5 truncate text-[13px] text-[#f4f4f5]">
                          <span className="truncate">{r.item.name}</span>
                          {r.project.private && <PrivateLock size={12} color="#5eead4" />}
                        </span>
                        <span className={cn("truncate text-xs text-dim", sub.over && "text-overdue")}>{sub.text}</span>
                      </button>
                      <StatePill state={r.state} />
                      <div className="flex shrink-0 items-center gap-1.5">
                        {actions(r).map((a, i) =>
                          a.label === "Reschedule" ? (
                            <RescheduleButton
                              key={a.label}
                              current={r.item.targetDate}
                              onPick={(d) => update(r.item, { targetDate: d ? isoDate(d) : "" }, d ? `${r.item.key} due ${shortDate(d)}` : `${r.item.key} due date cleared`)}
                              primary={i === 0}
                              overdue={isOverdue(r.item, r.state)}
                            />
                          ) : (
                            <Button key={a.label} variant={i === 0 ? "default" : "outline"} onClick={a.run}>
                              {a.label}
                            </Button>
                          ),
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {ready.length > 0 && (
          <section className="mb-6" aria-label="Ready to write about">
            <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-[#d4d4d8]">
              <Dot color="#c4b5fd" />
              Ready to write about
              <span className="font-normal text-dim">{ready.length}</span>
              <span className="ml-1 font-normal text-dim">· finished this week, not in a post yet</span>
              <Button variant="outline" size="sm" className="ml-auto" onClick={() => goShipLog(ready.map((r) => r.id))}>
                <NotebookPen className="size-3.5" /> Ship it
              </Button>
            </div>
            <div className="overflow-hidden rounded-[10px] border border-column-border bg-column">
              {ready.slice(0, 8).map((r) => (
                <button
                  key={r.id}
                  onClick={() => openItem({ projectId: r.projectId, itemId: r.id })}
                  className="flex w-full items-center gap-3 border-b border-column-border px-3.5 py-2.5 text-left last:border-b-0 hover:bg-[#121215]"
                >
                  <span className="w-[76px] shrink-0 font-mono text-[11px] text-dim">{r.key}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[#f4f4f5]">{r.name}</span>
                  <span className="shrink-0 text-xs text-dim">
                    {r.projectName} · done {ago(new Date(r.doneAt))}
                  </span>
                </button>
              ))}
              {ready.length > 8 && <div className="px-3.5 py-2 text-xs text-dim">and {ready.length - 8} more in Ship</div>}
            </div>
          </section>
        )}

        {hasPrivate && (
          <div className="mt-2 flex items-center gap-2 px-1 text-xs text-dim">
            <PrivateLock size={13} />
            {projects.filter((p) => p.private).map((p) => p.name).join(", ")}: encrypted on disk and hidden until unlocked
            {projects.some((p) => p.private && p.locked) ? " — locked items aren't listed here." : "."}
          </div>
        )}
    </Page>
  );
}
