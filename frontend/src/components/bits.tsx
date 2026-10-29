import { Bot, Lock } from "lucide-react";
import type { Project, State } from "@/lib/api";
import { glyphFor, stateColor } from "@/lib/plane";
import { cn } from "@/lib/utils";

export function ProjectGlyph({ project, size = 20, className }: { project: Pick<Project, "identifier" | "name">; size?: number; className?: string }) {
  const g = glyphFor(project);
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center font-semibold", className)}
      style={{ width: size, height: size, borderRadius: size / 4, background: g.bg, color: g.fg, fontSize: size * 0.55 }}
    >
      {g.letter}
    </span>
  );
}

export function Dot({ color, size = 8, className }: { color: string; size?: number; className?: string }) {
  return <span aria-hidden="true" className={cn("shrink-0 rounded-full", className)} style={{ width: size, height: size, background: color }} />;
}

export function StatePill({ state }: { state?: State }) {
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-[#2a2a30] px-2 text-[11px] text-[#b4b4bc]">
      <Dot color={stateColor(state)} size={6} />
      {state?.name ?? "Unknown"}
    </span>
  );
}

const ON = "#d4d4d8";
const OFF = "#3f3f46";

export function PriorityIcon({ priority, className }: { priority: string; className?: string }) {
  if (priority === "urgent") {
    return (
      <span role="img" aria-label="Urgent priority" className={cn("grid size-4 place-items-center rounded bg-[#7c2d12] text-[10px] font-bold text-[#fdba74]", className)}>
        !
      </span>
    );
  }
  const n = { low: 1, medium: 2, high: 3 }[priority] ?? 0;
  return (
    <span role="img" aria-label={`${priority || "no"} priority`} className={cn("inline-flex h-2.5 items-end gap-0.5", className)}>
      {[4, 7, 10].map((h, i) => (
        <span key={h} className="w-[3px] rounded-[1px]" style={{ height: h, background: n > i ? ON : OFF }} />
      ))}
    </span>
  );
}

export function PrivateLock({ size = 13, className, color }: { size?: number; className?: string; color?: string }) {
  return (
    <Lock
      role="img"
      aria-label="Locked project"
      width={size}
      height={size}
      strokeWidth={1.9}
      className={className}
      style={color ? { color } : undefined}
    />
  );
}

export function AgentTag({ label = "agent" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-agent">
      <Bot className="size-3" strokeWidth={2} />
      {label}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-[11px] font-medium uppercase tracking-[.06em] text-dim", className)}>{children}</div>;
}
