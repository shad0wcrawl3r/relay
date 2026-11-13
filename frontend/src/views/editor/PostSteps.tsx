import { Check } from "lucide-react";
import { ago } from "@/lib/time";

// Where a post is on its way out: written here, sent to Dev.to as a draft,
// published, promoted. A green tick per step reached, a grey dot per step
// ahead; each one's name is in its tooltip. The footer's main button is
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
    <ol aria-label="Post status" className="m-0 flex h-6 list-none items-center gap-1.5 p-0">
      {STEPS.map((label, i) => {
        const reached = i <= step;
        const detail = i === 1 && sentAt ? ` · sent ${ago(sentAt)}` : i === 3 && promotions > 0 ? ` · ${promotions}` : "";
        const title = reached ? `${label}${detail}` : `${label}: not yet`;
        return (
          <li key={label} title={title} aria-label={title} aria-current={i === step ? "step" : undefined} className="flex size-3.5 items-center justify-center">
            {reached ? <Check aria-hidden className="size-3.5 text-[#4ade80]" strokeWidth={2.5} /> : <span aria-hidden className="size-1.5 rounded-full bg-[#52525b]" />}
          </li>
        );
      })}
    </ol>
  );
}
