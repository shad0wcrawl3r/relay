import { useMemo, useState } from "react";
import { usePlane } from "@/lib/store";
import { ATTENTION_GROUPS, attentionRows, findState, findStateByGroup, isOverdue, type AttentionRow } from "@/lib/plane";
import { ago, daysLate, duration, isoDate, shortDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Dot, PrivateLock, ProjectGlyph, StatePill } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { RescheduleButton } from "@/components/Reschedule";
import type { Project } from "@/lib/api";
import type { OpenItem } from "@/App";

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

export function Attention({ openItem }: { openItem: (o: OpenItem) => void }) {
  const { projects, update, snapshot } = usePlane();
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

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="drag h-10 shrink-0" />
      <div className="mx-auto flex max-w-[980px] flex-col px-8 pb-10">
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <div className="flex-[1_1_320px]">
            <h1 className="m-0 text-[22px] font-semibold tracking-[-.01em] text-strong">Attention</h1>
            <p className="mt-1 text-[13px] text-dim">
              {!snapshot?.connected
                ? "Connect Plane in Settings to see what's waiting on you."
                : rows.length === 0
                  ? "Nothing is waiting on you."
                  : `${rows.length} item${rows.length === 1 ? "" : "s"} across ${projectCount} project${projectCount === 1 ? "" : "s"} ${rows.length === 1 ? "is" : "are"} waiting on you.`}
            </p>
          </div>
          {projects.length > 0 && (
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
          )}
        </div>

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
                    <div key={r.item.id} className="flex items-center gap-3 border-b border-column-border px-3.5 py-2.5 last:border-b-0 hover:bg-[#121215]">
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

        {hasPrivate && (
          <div className="mt-2 flex items-center gap-2 px-1 text-xs text-dim">
            <PrivateLock size={13} />
            {projects.filter((p) => p.private).map((p) => p.name).join(", ")} items are fetched live and kept in memory only — never cached to disk.
          </div>
        )}
      </div>
    </main>
  );
}
