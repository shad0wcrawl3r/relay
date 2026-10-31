import { useState } from "react";
import { Check, Library, Plus, X } from "lucide-react";
import { PostService } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function SeriesSelect({ value, onChange }: { value: string; onChange: (series: string) => void }) {
  const [open, setOpen] = useState(false);
  const [series, setSeries] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  const toggle = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      PostService.Series().then(setSeries).catch(() => {});
    }
  };
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  const typed = query.trim();
  const matches = series.filter((s) => s.toLowerCase().includes(typed.toLowerCase()));
  const isNew = typed !== "" && !series.some((s) => s.toLowerCase() === typed.toLowerCase());

  return (
    <div className="mt-3 flex items-center gap-1">
      <Popover open={open} onOpenChange={toggle}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "inline-flex h-7 max-w-[420px] items-center gap-1.5 rounded-md px-2 text-[13px] hover:bg-[#27272a]",
              value ? "text-[#e4e4e7]" : "text-dim-2",
            )}
          >
            <Library className="size-3.5 shrink-0" strokeWidth={1.8} />
            <span className="truncate">{value || "Add to a series"}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-[300px] flex-col gap-1 p-2">
          <input
            autoFocus
            aria-label="Series name"
            value={query}
            placeholder="Find or name a series"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && typed) {
                e.preventDefault();
                pick(series.find((s) => s.toLowerCase() === typed.toLowerCase()) ?? typed);
              }
            }}
            className="h-8 rounded-md bg-transparent px-2 text-[13px] text-strong outline-none placeholder:text-dim"
          />
          <div className="max-h-[220px] overflow-y-auto">
            {matches.map((s) => (
              <button key={s} onClick={() => pick(s)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-foreground hover:bg-accent">
                <span className="grow truncate">{s}</span>
                {s === value && <Check className="size-3.5 shrink-0" />}
              </button>
            ))}
            {isNew && (
              <button onClick={() => pick(typed)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-foreground hover:bg-accent">
                <Plus className="size-3.5 shrink-0" />
                <span className="truncate">Create “{typed}”</span>
              </button>
            )}
            {matches.length === 0 && !isNew && <p className="m-0 px-2 py-1.5 text-xs text-dim">Type a name to start a series.</p>}
          </div>
        </PopoverContent>
      </Popover>
      {value && (
        <button aria-label="Remove from series" onClick={() => onChange("")} className="grid size-[22px] place-items-center rounded text-muted-foreground hover:text-strong">
          <X className="size-3" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
