import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import type { AIUse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const OPTIONS: { value: AIUse; label: string; hint: string }[] = [
  { value: "none", label: "No AI", hint: "You wrote it without AI." },
  { value: "assisted", label: "AI-assisted", hint: "You wrote it, with help from AI." },
  { value: "generated", label: "AI-generated", hint: "AI wrote most of it." },
];

/** Normalises a stored value: empty (posts from before the setting) is "none". */
export const aiUse = (v: string): AIUse => (v === "assisted" || v === "generated" ? v : "none");

/** How much AI went into the post. Relay sets Dev.to's own AI-use marker
 *  (the "AI:" setting in its editor) when it sends the article. */
export function AIUseSelect({ value, onChange }: { value: string; onChange: (v: AIUse) => void }) {
  const [open, setOpen] = useState(false);
  const current = OPTIONS.find((o) => o.value === aiUse(value))!;
  return (
    <div className="mt-1 flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            aria-label="AI use"
            className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] hover:bg-[#27272a]", current.value === "none" ? "text-dim-2" : "text-[#e4e4e7]")}
          >
            <Sparkles className="size-3.5 shrink-0" strokeWidth={1.8} />
            {current.label}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-[340px] flex-col gap-1 p-2">
          <p className="m-0 px-2 pb-1 pt-0.5 text-xs leading-snug text-dim">
            Dev.to asks you to disclose AI use. Relay sets Dev.to's AI marker (the “AI:” setting in its editor) when it sends the article.
          </p>
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
            >
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="text-[13px] text-foreground">{o.label}</span>
                <span className="text-xs text-dim">{o.hint}</span>
              </span>
              {o.value === current.value && <Check className="mt-0.5 size-3.5 shrink-0" />}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
