import { CalendarDays, LayoutGrid, MessageSquare } from "lucide-react";
import type { Item, Project, State } from "@/lib/api";
import { isOverdue, norm } from "@/lib/plane";
import { duration, shortDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { AgentTag, PriorityIcon } from "@/components/bits";
import { usePlane } from "@/lib/store";

export const DRAG_MIME = "application/x-relay-item";

export function cardVariant(it: Item, s?: State): "needs" | "working" | "" {
  const n = norm(s?.name);
  if (n === "agent working") return "working";
  if (n === "needs review" || (n === "in debate" && it.lastCommentByAgent)) return "needs";
  return "";
}

const variantCls = {
  needs: "border-[#8a2e5c] shadow-[0_0_0_1px_rgba(236,72,153,.28)]",
  working: "border-[#3e3f8f]",
  "": "",
};

interface CardProps {
  item: Item;
  project: Project;
  state?: State;
  selected?: boolean;
  compact?: boolean;
  onOpen: () => void;
}

function startDrag(e: React.DragEvent, it: Item) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ id: it.id, projectId: it.projectId }));
  e.dataTransfer.effectAllowed = "move";
}

export function ItemCard({ item: it, project, state, selected, compact, onOpen }: CardProps) {
  const { readOnly } = usePlane();
  const variant = cardVariant(it, state);
  const n = norm(state?.name);
  const labels = project.labels.filter((l) => it.labelIds?.includes(l.id));
  const module = project.modules.find((m) => it.moduleIds?.includes(m.id));
  const overdue = isOverdue(it, state);
  const working = n === "agent working";
  const yourTurn = n === "in debate" && it.lastCommentByAgent;
  const blocked = n === "blocked" || n === "waiting on student";

  if (compact) {
    return (
      <article
        draggable={!readOnly}
        onDragStart={(e) => startDrag(e, it)}
        onClick={onOpen}
        className={cn(
          "flex cursor-grab flex-col gap-1.5 rounded-[7px] border border-card-border bg-card px-2.5 py-2 hover:border-card-hover active:cursor-grabbing",
          variantCls[variant],
          selected && "border-[#f4f4f5] shadow-[0_0_0_1px_#f4f4f5]",
        )}
      >
        <div className="flex items-center gap-1.5">
          <span className={cn("font-mono text-[10.5px] text-dim", overdue && "text-overdue")}>{it.key}</span>
          <span className="flex-1" />
          {working && <span className="pulse-dot" />}
          {it.agent && !working && <AgentTag label="" />}
          {it.priority !== "none" && <PriorityIcon priority={it.priority} />}
        </div>
        <div className="text-[12.5px] leading-[1.35] text-[#f4f4f5]">{it.name}</div>
      </article>
    );
  }

  return (
    <article
      draggable={!readOnly}
      onDragStart={(e) => startDrag(e, it)}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      tabIndex={0}
      className={cn(
        "flex cursor-grab flex-col gap-2 rounded-lg border border-card-border bg-card px-3 py-2.5 outline-none hover:border-card-hover focus-visible:border-[#71717a] active:cursor-grabbing",
        variantCls[variant],
        selected && "border-[#f4f4f5] shadow-[0_0_0_1px_#f4f4f5]",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-dim">{it.key}</span>
        <span className="flex-1" />
        {it.priority !== "none" && <PriorityIcon priority={it.priority} />}
      </div>
      <div className="text-[13px] leading-[1.4] text-[#f4f4f5]">{it.name}</div>
      {blocked && <div className="text-xs text-[#fca5a5]">{state?.name} for {duration(it.updatedAt)}</div>}
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {labels.map((l) => (
            <span key={l.id} className="inline-flex h-5 items-center gap-1 rounded-full border border-[#2a2a30] px-[7px] text-[11px] text-[#b4b4bc]">
              <span className="size-1.5 rounded-full" style={{ background: l.color || "#71717a" }} />
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2.5 text-[11px] text-dim">
        {module && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <LayoutGrid className="size-[11px] shrink-0" strokeWidth={2} />
            <span className="truncate">{module.name}</span>
          </span>
        )}
        {it.targetDate && (
          <span className={cn("inline-flex shrink-0 items-center gap-1", overdue && "text-overdue")}>
            <CalendarDays className="size-[11px]" strokeWidth={2} />
            {shortDate(it.targetDate)}
          </span>
        )}
        <span className="flex-1" />
        {it.commentCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-[11px]" strokeWidth={2} />
            {it.commentCount}
          </span>
        )}
        {yourTurn && <span className="text-[#f9a8d4]">your turn</span>}
        {working ? (
          <span className="inline-flex items-center gap-1.5 text-agent">
            <span className="pulse-dot" />
            working · {duration(it.updatedAt)}
          </span>
        ) : (
          it.agent && <AgentTag />
        )}
      </div>
    </article>
  );
}
