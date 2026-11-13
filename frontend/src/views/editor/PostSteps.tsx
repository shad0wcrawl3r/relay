import { Check } from "lucide-react";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";

// Where a post is on its way out: written here, sent to Dev.to as a draft,
// published, promoted. Shown above the article: a green tick for each step
// reached, a grey dot for each step ahead. The footer's main button is
// always the next step.

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
    <ol aria-label="Post status" className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-xs">
      {STEPS.map((label, i) => {
        const reached = i <= step;
        const detail = i === 1 && sentAt ? ` · sent ${ago(sentAt)}` : i === 3 && promotions > 0 ? ` · ${promotions}` : "";
        return (
          <li
            key={label}
            aria-current={i === step ? "step" : undefined}
            title={reached ? undefined : "Not yet"}
            className={cn("flex items-center gap-1.5", reached ? "text-muted-foreground" : "text-[#52525b]")}
          >
            {reached ? (
              <Check aria-hidden className="size-3.5 text-[#4ade80]" strokeWidth={2.5} />
            ) : (
              <span aria-hidden className="mx-1 size-1.5 rounded-full bg-[#52525b]" />
            )}
            {label}
            {reached && detail}
          </li>
        );
      })}
    </ol>
  );
}
