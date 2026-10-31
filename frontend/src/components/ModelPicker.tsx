import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Picks from a provider's models. Accepts any typed name, since a custom
 *  endpoint may not list everything it serves. */
export function ModelPicker({ models, value, onChange }: { models: string[]; value: string; onChange: (model: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const toggle = (next: boolean) => {
    setOpen(next);
    if (next) setQuery("");
  };
  const pick = (model: string) => {
    onChange(model);
    setOpen(false);
  };

  const typed = query.trim();
  const matches = models.filter((m) => m.toLowerCase().includes(typed.toLowerCase()));
  const exact = models.some((m) => m === typed);

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <button
          aria-label="Model"
          className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-background px-3 text-left text-[13px] text-strong outline-none focus:border-[#52525b]"
        >
          <span className={value ? "grow truncate" : "grow truncate text-dim"}>{value || "Choose a model"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-dim" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-[var(--radix-popover-trigger-width)] flex-col gap-1 p-2">
        <input
          autoFocus
          aria-label="Search models"
          value={query}
          placeholder={`Search ${models.length} models`}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && typed) {
              e.preventDefault();
              pick(matches[0] ?? typed);
            }
          }}
          className="h-8 rounded-md bg-transparent px-2 text-[13px] text-strong outline-none placeholder:text-dim"
        />
        <div className="max-h-[260px] overflow-y-auto">
          {matches.map((m) => (
            <button key={m} onClick={() => pick(m)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left font-mono text-xs text-foreground hover:bg-accent">
              <span className="grow truncate">{m}</span>
              {m === value && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}
          {typed && !exact && (
            <button onClick={() => pick(typed)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground hover:bg-accent">
              <span className="truncate">Use “{typed}”</span>
            </button>
          )}
          {!typed && models.length === 0 && <p className="m-0 px-2 py-1.5 text-xs text-dim">No models listed. Type a model name.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
