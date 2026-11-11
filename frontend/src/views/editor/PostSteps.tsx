import { Check, ChevronRight } from "lucide-react";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";

// Where a post is on its way out: written here, sent to Dev.to as a draft,
// published, promoted. The footer's main button is always the next step.

const STEPS = ["Local", "Draft on Dev.to", "Published", "Promoted"] as const;

/** The current step. Promoted only counts while the article is live: a
 * promotion record on a draft (or a deleted article) isn't a promotion. */
export function postStep(sent: boolean, published: boolean, promotions: number) {
  if (published) return promotions > 0 ? 3 : 2;
  return sent ? 1 : 0;
}

export function PostSteps({ step, sentAt, promotions, gone }: { step: number; sentAt?: string; promotions: number; gone?: boolean }) {
  if (gone)
    return (
      <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[rgba(248,113,113,.1)] px-2 text-xs text-[#fca5a5]">
        <span aria-hidden className="size-1.5 rounded-full bg-[#f87171]" />
        Gone from Dev.to
      </span>
    );
  return (
    <ol aria-label="Post status" className="m-0 flex list-none items-center gap-1 p-0 text-xs">
      {STEPS.map((label, i) => {
        const done = i < step;
        const current = i === step;
        const detail = current && i === 1 && sentAt ? ` · sent ${ago(sentAt)}` : current && i === 3 ? ` · ${promotions}` : "";
        return (
          <li key={label} className="flex items-center gap-1" aria-current={current ? "step" : undefined}>
            {i > 0 && <ChevronRight aria-hidden className="size-3 text-[#3f3f46]" />}
            <span
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-full px-2",
                current ? "bg-[#1f1f23] text-strong" : done ? "text-muted-foreground" : "text-[#52525b]",
              )}
            >
              {done && <Check aria-hidden className="size-3 text-[#4ade80]" />}
              {current && <span aria-hidden className="size-1.5 rounded-full" style={{ background: ["#a1a1aa", "#60a5fa", "#4ade80", "#c4b5fd"][i] }} />}
              {label}
              {detail}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
