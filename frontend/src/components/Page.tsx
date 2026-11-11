import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// The frame every scrolling view shares: the drag strip under the title
// bar, a centred column, and one header (title, subtitle, actions).

export function Page({
  title,
  subtitle,
  actions,
  width = "max-w-[980px]",
  gap,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** The column's max width class. */
  width?: string;
  /** Gap between the header and sections, when the view spaces them evenly. */
  gap?: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="drag h-10 shrink-0" />
      <div className={cn("mx-auto flex flex-col px-8 pb-10", width, gap)}>
        <PageHeader title={title} subtitle={subtitle} actions={actions} className={gap ? undefined : "mb-6"} />
        {children}
      </div>
    </main>
  );
}

export function PageHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      <div className="min-w-0 flex-[1_1_320px]">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-.01em] text-strong">{title}</h1>
        {subtitle && <div className="mt-1 text-[13px] text-dim">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** True once `ms` has passed while `on` holds, so quick loads don't flash a skeleton. */
export function useDelayed(on: boolean, ms = 150) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) {
      setLate(false);
      return;
    }
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && late;
}

/** Placeholder rows shaped like a list while it loads. */
export function SkeletonRows({ rows = 3, label = "Loading", className }: { rows?: number; label?: string; className?: string }) {
  const show = useDelayed(true);
  return (
    <div role="status" aria-label={label} className={cn("overflow-hidden rounded-[10px] border border-column-border bg-column", className)}>
      {show &&
        Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-column-border px-3.5 py-3 last:border-b-0">
            <span className="size-5 shrink-0 animate-pulse rounded-[5px] bg-[#1c1c20]" />
            <div className="flex grow flex-col gap-1.5">
              <span className="h-3 animate-pulse rounded bg-[#1c1c20]" style={{ width: `${62 - i * 9}%` }} />
              <span className="h-2.5 w-1/4 animate-pulse rounded bg-[#18181b]" />
            </div>
          </div>
        ))}
    </div>
  );
}

/** An empty list: what it means and, when there is one, the next step. */
export function EmptyState({ title, body, action, className }: { title: string; body?: ReactNode; action?: { label: string; onClick: () => void; icon?: ReactNode }; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-column-border px-6 py-10 text-center", className)}>
      <p className="m-0 text-[13px] text-muted-foreground">{title}</p>
      {body && <p className="m-0 max-w-[420px] text-xs text-dim">{body}</p>}
      {action && (
        <Button size="md" variant="outline" className="mt-2" onClick={action.onClick}>
          {action.icon}
          {action.label}
        </Button>
      )}
    </div>
  );
}
