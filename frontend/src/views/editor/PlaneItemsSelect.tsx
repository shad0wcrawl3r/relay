import { useMemo, useState } from "react";
import { Check, Link2, Plus, X } from "lucide-react";
import type { Post } from "@/lib/api";
import { usePlane } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Link = Post["planeItems"][number];

// The Plane items a post is about (RELAY-71). Only IDs are stored. Items from
// lockable projects aren't offered, and links to them aren't shown, unlocked
// or not, the same rule as Ship.

export function PlaneItemsSelect({ value, onChange }: { value: Link[] | undefined; onChange: (v: Link[]) => void }) {
  const { snapshot } = usePlane();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const links = value ?? [];

  const items = useMemo(() => {
    const out: { projectId: string; projectName: string; id: string; key: string; name: string }[] = [];
    for (const p of snapshot?.projects ?? []) {
      if (p.private || p.locked || p.source === "buffer") continue;
      for (const it of p.items ?? []) out.push({ projectId: p.id, projectName: p.name, id: it.id, key: it.key, name: it.name });
    }
    return out;
  }, [snapshot]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const shown = links.map((l) => byId.get(l.itemId)).filter((i): i is NonNullable<typeof i> => !!i);
  const linked = new Set(links.map((l) => l.itemId));
  const q = query.trim().toLowerCase();
  const matches = (q ? items.filter((i) => i.key.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)) : items).slice(0, 40);

  const toggle = (i: (typeof items)[number]) =>
    onChange(linked.has(i.id) ? links.filter((l) => l.itemId !== i.id) : [...links, { projectId: i.projectId, itemId: i.id }]);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {shown.map((i) => (
        <span key={i.id} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#18181b] px-2 text-[13px] text-[#e4e4e7]">
          <Link2 className="size-3.5 shrink-0 text-dim" strokeWidth={1.8} />
          <span className="font-mono text-xs text-dim">{i.key}</span>
          <span className="max-w-[260px] truncate">{i.name}</span>
          <button aria-label={`Unlink ${i.key}`} className="text-dim hover:text-strong" onClick={() => toggle(i)}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button aria-label="Link Plane items" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-dim-2 hover:bg-[#27272a]">
            {shown.length ? <Plus className="size-3.5" /> : <Link2 className="size-3.5" strokeWidth={1.8} />}
            {shown.length ? "" : "Link Plane items"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-[380px] flex-col gap-1 p-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items by key or title"
            className="h-8 rounded-md border border-border bg-[#111113] px-2 text-[13px] outline-none focus:border-border-strong"
          />
          <div className="flex max-h-[280px] flex-col overflow-y-auto">
            {matches.length === 0 && <p className="m-0 px-2 py-3 text-xs text-dim">No items match. Private projects aren't listed.</p>}
            {matches.map((i) => (
              <button key={i.id} onClick={() => toggle(i)} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent")}>
                <span className="w-[72px] shrink-0 font-mono text-xs text-dim">{i.key}</span>
                <span className="min-w-0 grow truncate text-[13px] text-foreground">{i.name}</span>
                {linked.has(i.id) && <Check className="size-3.5 shrink-0" />}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
