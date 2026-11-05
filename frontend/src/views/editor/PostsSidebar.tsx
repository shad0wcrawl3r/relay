import { useMemo, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import type { PostList, PostSummary } from "@/lib/api";
import { ago, compactNumber, shortDate } from "@/lib/time";
import { cn } from "@/lib/utils";

type Filter = "all" | "drafts" | "published";

function subtitle(p: PostSummary, now: number): string {
  if (p.published) return [shortDate(p.publishedAt), `${compactNumber(p.views)} views`].filter(Boolean).join(" · ");
  if (p.devtoId) return `On Dev.to · ${shortDate(p.sentAt) || "draft"}`;
  const edited = ago(p.updatedAt, now);
  return `Local only · ${edited.endsWith("ago") || edited === "just now" ? `edited ${edited}` : edited}`;
}

export function PostsSidebar({
  list,
  activeId,
  syncing,
  onOpen,
  onNew,
  onSync,
}: {
  list: PostList | null;
  activeId?: string;
  syncing: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onSync: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const now = Date.now();
  const posts = list?.posts ?? [];
  const drafts = posts.filter((p) => !p.published);
  const published = posts.filter((p) => p.published);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter((p) => (!q || p.title.toLowerCase().includes(q)) && (filter === "all" || (filter === "drafts" ? !p.published : p.published)));
  }, [posts, query, filter]);

  const group = (title: string, rows: PostSummary[]) =>
    rows.length > 0 && (
      <>
        <div className="px-2 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-[.06em] text-muted-foreground [&:not(:first-child)]:pt-3.5">{title}</div>
        {rows.map((p) => {
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              onClick={() => onOpen(p.id)}
              aria-current={active ? "page" : undefined}
              className={cn("flex flex-col gap-1.5 rounded-lg px-3 py-2.5 text-left hover:bg-[#141417]", active && "bg-[#18181b] shadow-[inset_0_0_0_1px_#27272a] hover:bg-[#18181b]")}
            >
              <span className={cn("text-sm font-medium leading-[1.35]", active ? "text-strong" : "text-[#e4e4e7]")}>{p.title || "Untitled post"}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {p.published ? (
                  <span className="rounded bg-[rgba(74,222,128,.1)] px-[7px] py-px font-medium text-[#4ade80]">Published</span>
                ) : (
                  <span className="rounded bg-[#27272a] px-[7px] py-px font-medium text-strong">Draft</span>
                )}
                <span className="truncate">{subtitle(p, now)}</span>
              </span>
            </button>
          );
        })}
      </>
    );

  return (
    <aside aria-label="Posts" className="flex w-[280px] shrink-0 flex-col border-r border-border">
      <div className="drag flex h-[calc(56px+28px)] shrink-0 items-end justify-between border-b border-border pb-2 pl-4 pr-2">
        <h2 className="m-0 pb-2.5 text-sm font-semibold text-strong">Posts</h2>
        <button aria-label="New post" onClick={onNew} className="no-drag grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-strong">
          <Plus className="size-[18px]" strokeWidth={1.9} />
        </button>
      </div>
      <div className="flex flex-col gap-2.5 p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-[11px] size-[15px] text-dim-2" strokeWidth={1.9} />
          <input
            aria-label="Search posts"
            placeholder="Search posts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-transparent pl-8 pr-2.5 text-[13px] text-[#e4e4e7] outline-none placeholder:text-dim-2 focus:border-[#52525b]"
          />
        </div>
        <div className="flex gap-0.5 rounded-lg bg-[#27272a] p-[3px]">
          {(
            [
              ["all", `All ${posts.length}`],
              ["drafts", `Drafts ${drafts.length}`],
              ["published", `Published ${published.length}`],
            ] as const
          ).map(([f, label]) => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn("h-7 flex-1 rounded-md text-xs font-medium text-muted-foreground", filter === f && "bg-background text-strong")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 grow flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {group("Drafts", shown.filter((p) => !p.published))}
        {group("Published", shown.filter((p) => p.published))}
        {shown.length === 0 && <p className="px-2 text-xs text-dim">{posts.length ? "No posts match." : "No posts yet. Start one with +."}</p>}
      </div>
      <div className="flex items-center gap-1 border-t border-border py-2.5 pl-2 pr-3 text-xs text-muted-foreground" title={list?.error || undefined}>
        <button aria-label="Sync with Dev.to" onClick={onSync} className="grid size-10 shrink-0 place-items-center rounded-md hover:bg-accent hover:text-strong">
          <RefreshCw className={cn("size-[15px]", syncing && "animate-spin")} strokeWidth={1.9} />
        </button>
        <span className={cn("truncate", list?.error && "text-overdue")}>
          {syncing
            ? "Syncing with Dev.to…"
            : list?.noKey
              ? "Writing locally · add a Dev.to key in Settings to send"
              : list?.error
              ? list.error
              : list?.syncedAt && !list.syncedAt.startsWith("0001")
                ? `Synced with Dev.to · ${ago(list.syncedAt, now)}`
                : "Not synced with Dev.to"}
        </span>
      </div>
    </aside>
  );
}
