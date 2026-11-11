import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Browser, Clipboard } from "@wailsio/runtime";
import { AlertTriangle, Check, ChevronDown, Clock, Copy, ExternalLink, FileText, GripVertical, Loader2, Pencil, PenLine, RotateCcw, Search, Trash2 } from "lucide-react";
import { BufferService, type BufferChannel, type BufferPost, type BufferPostStatus, type PromotedArticle } from "@/lib/api";
import { ago } from "@/lib/time";
import { cn, errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { LIMITS } from "@/components/PostPreview";
import { EmptyState, SkeletonRows } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, serviceName } from "@/views/buffer/Buffer";
import { clock, dayKey, dayLabel, localInput, nextSlotAt, onDay, postTime } from "@/views/buffer/schedule";

// The Buffer posts list as a schedule: grouped by day, each post editable in
// place, rescheduled from a menu or by dragging it onto another day, and
// driven from the keyboard. Buffer can edit text and time and delete; it
// can't share now or reorder, so neither is offered. Every change is one
// Buffer call the user asked for; nothing here polls.

export interface PostTab {
  id: string;
  label: string;
  statuses: BufferPostStatus[];
  empty: string;
}

const DRAG_MIME = "application/x-relay-buffer-post";
const LONG_TEXT = 280;

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function PostList({
  orgId,
  tab,
  channelIds,
  channelById,
  highlightId,
  onCompose,
  goPost,
}: {
  orgId: string;
  tab: PostTab;
  channelIds: string[];
  channelById: Map<string, BufferChannel>;
  highlightId?: string;
  /** Opens the composer, with text to start from. */
  onCompose: (text: string) => void;
  goPost: (postId: string) => void;
}) {
  const toast = useToast();
  const [posts, setPosts] = useState<BufferPost[]>([]);
  const [cursor, setCursor] = useState("");
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<BufferPost | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(highlightId ?? null);
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [promoted, setPromoted] = useState<Record<string, PromotedArticle>>({});
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (after: string) => {
      setLoading(true);
      setError("");
      const q = { organizationId: orgId, statuses: tab.statuses, channelIds, after };
      if (!after) {
        // Show the last copy at once; the fresh page replaces it.
        const cached = await BufferService.CachedPosts(q).catch(() => null);
        if (cached) {
          setPosts(cached.posts);
          setCursor(cached.cursor);
          setMore(cached.more);
        }
      }
      try {
        const page = await BufferService.Posts(q);
        setPosts((cur) => (after ? [...cur, ...page.posts] : page.posts));
        setCursor(page.cursor);
        setMore(page.more);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    // channelIds is a fresh array each render; the key on PostList remounts on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId, tab],
  );

  useEffect(() => {
    fetchPage("");
    BufferService.PromotionIndex().then(setPromoted, () => {});
  }, [fetchPage]);

  const mark = (id: string, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const replace = (p: BufferPost) => setPosts((cur) => cur.map((x) => (x.id === p.id ? p : x)));

  /** One edit to Buffer. Undo for a time change puts the old time back if it's still ahead. */
  const edit = async (p: BufferPost, change: { text?: string; dueAt?: Date }, message: string) => {
    mark(p.id, true);
    try {
      const saved = await BufferService.EditPost(p.id, change.text ?? p.text, change.dueAt ? change.dueAt.toISOString() : "");
      replace(saved);
      const before = postTime(p);
      const undo =
        change.dueAt && before && before > new Date()
          ? () => edit(saved, { dueAt: before }, "Moved back")
          : change.text !== undefined && change.text !== p.text
            ? () => edit(saved, { text: p.text }, "Text restored")
            : null;
      toast(
        {
          tone: "success",
          title: message,
          actions: undo && message !== "Moved back" && message !== "Text restored" ? [{ label: "Undo", onClick: undo }] : undefined,
        },
        undo ? 6000 : undefined,
      );
      return true;
    } catch (err) {
      toast({ tone: "error", title: "Buffer didn't take the change", body: errorMessage(err) });
      return false;
    } finally {
      mark(p.id, false);
    }
  };

  const reschedule = (p: BufferPost, at: Date) => {
    if (at <= new Date()) {
      toast({ tone: "error", title: "Pick a time in the future" });
      return;
    }
    setRescheduling(null);
    edit(p, { dueAt: at }, `Moved to ${dayLabel(at).replace(/ · .*/, "")} ${clock(at)}`);
  };

  const copy = async (p: BufferPost) => {
    await Clipboard.SetText(p.text);
    toast({ tone: "success", title: "Copied the post's text" });
  };

  const remove = async (p: BufferPost) => {
    mark(p.id, true);
    try {
      await BufferService.DeletePost(p.id);
      setPosts((cur) => cur.filter((x) => x.id !== p.id));
      toast({ tone: "success", title: "Post deleted from Buffer" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the post", body: errorMessage(err) });
    } finally {
      mark(p.id, false);
      setDeleting(null);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? posts.filter((p) => p.text.toLowerCase().includes(q) || (channelById.get(p.channelId)?.name ?? "").toLowerCase().includes(q)) : posts;
    // Sorted by time, so a rescheduled post lands in its new day: upcoming
    // soonest first, sent and failed newest first. Undated posts go last.
    const ahead = tab.id === "queue" || tab.id === "approval";
    const at = (p: BufferPost) => postTime(p)?.getTime() ?? (ahead ? Infinity : -Infinity);
    return [...matched].sort((a, b) => (ahead ? at(a) - at(b) : at(b) - at(a)));
  }, [posts, query, channelById, tab.id]);

  // Days in list order. Drafts aren't grouped.
  const groups = useMemo(() => {
    if (tab.id === "drafts") return [{ key: "all", label: "", day: null as Date | null, posts: shown }];
    const out: { key: string; label: string; day: Date | null; posts: BufferPost[] }[] = [];
    for (const p of shown) {
      const t = postTime(p);
      const key = t ? dayKey(t) : "none";
      let g = out.find((x) => x.key === key);
      if (!g) {
        g = { key, label: t ? dayLabel(t) : "No time set", day: t, posts: [] };
        out.push(g);
      }
      g.posts.push(p);
    }
    return out;
  }, [shown, tab.id]);
  const ordered = useMemo(() => groups.flatMap((g) => g.posts), [groups]);
  const canMove = tab.id === "queue" || tab.id === "approval";

  // Keyboard, while no dialog is open and nothing is being typed into.
  const live = useRef({ ordered, selected, editing });
  live.current = { ordered, selected, editing };
  const actions = useRef({ copy, setEditing, setDeleting, setRescheduling, setExpanded });
  actions.current = { copy, setEditing, setDeleting, setRescheduling, setExpanded };
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("[role=dialog]")) return;
      const { ordered, selected, editing } = live.current;
      if (editing || ordered.length === 0) return;
      const i = ordered.findIndex((p) => p.id === selected);
      const go = (n: number) => {
        const p = ordered[Math.max(0, Math.min(ordered.length - 1, n))];
        setSelected(p.id);
        rowRefs.current.get(p.id)?.scrollIntoView({ block: "nearest" });
      };
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown") return (e.preventDefault(), go(i < 0 ? 0 : i + 1));
      if (k === "k" || e.key === "ArrowUp") return (e.preventDefault(), go(i < 0 ? 0 : i - 1));
      const p = ordered[i];
      if (!p) return;
      const a = actions.current;
      const can = (x: string) => p.actions.includes(x);
      if (e.key === "Enter") {
        e.preventDefault();
        a.setExpanded((s) => {
          const n = new Set(s);
          if (n.has(p.id)) n.delete(p.id);
          else n.add(p.id);
          return n;
        });
      } else if (k === "e" && can("updatePost")) {
        e.preventDefault();
        a.setEditing(p.id);
      } else if (k === "c") {
        e.preventDefault();
        a.copy(p);
      } else if (k === "r" && can("updatePostSchedule") && p.status !== "sent") {
        e.preventDefault();
        a.setRescheduling(p.id);
      } else if ((e.key === "Backspace" || e.key === "Delete") && can("deletePost")) {
        e.preventDefault();
        a.setDeleting(p);
      }
    };
    // Capture, so these keys win over the app's single-key view switches
    // (E is also "go to Posts"); App skips events already handled.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (highlightId) rowRefs.current.get(highlightId)?.scrollIntoView({ block: "center" });
  }, [highlightId, posts.length]);

  if (error && posts.length === 0) return <p className="text-xs text-overdue">{error}</p>;
  if (loading && posts.length === 0) return <SkeletonRows label="Loading posts" />;
  if (!loading && posts.length === 0)
    return (
      <EmptyState
        title={tab.empty}
        action={tab.id === "queue" || tab.id === "drafts" ? { label: "Write a post", onClick: () => onCompose(""), icon: <PenLine className="size-3.5" /> } : undefined}
      />
    );

  const dropOn = (day: Date | null) => (e: React.DragEvent) => {
    e.preventDefault();
    setDropDay(null);
    const id = e.dataTransfer.getData(DRAG_MIME);
    const p = posts.find((x) => x.id === id);
    const was = p && postTime(p);
    if (!p || !was || !day || dayKey(was) === dayKey(day)) return;
    reschedule(p, onDay(was, day));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative max-w-[320px] grow">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tab.label.toLowerCase()}`} className="h-8 pl-8 text-[13px]" aria-label="Search posts" />
        </div>
        <span className="text-xs text-dim">
          {query ? `${shown.length} of ${posts.length}` : `${posts.length}${more ? "+" : ""}`} post{posts.length === 1 ? "" : "s"}
        </span>
        {loading && (
          <span className="flex items-center gap-1.5 text-xs text-dim">
            <Loader2 className="size-3 animate-spin" /> Refreshing…
          </span>
        )}
        <span className="ml-auto text-[11px] text-dim">
          <kbd className="kbd">J</kbd> <kbd className="kbd">K</kbd> move · <kbd className="kbd">E</kbd> edit
          {canMove && (
            <>
              {" "}
              · <kbd className="kbd">R</kbd> reschedule · drag onto a day
            </>
          )}
        </span>
      </div>
      {error && <p className="m-0 text-xs text-overdue">Couldn't refresh: {error}. Showing the last copy.</p>}
      {query && shown.length === 0 && <p className="m-0 px-1 text-[13px] text-dim">No posts match “{query}”.</p>}

      {groups.map((g) => (
        <section
          key={g.key}
          aria-label={g.label || tab.label}
          className={cn("flex flex-col gap-1.5 rounded-[12px]", canMove && dropDay === g.key && "outline outline-1 outline-offset-2 outline-[#60a5fa]")}
          onDragOver={
            canMove
              ? (e) => {
                  if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
                  e.preventDefault();
                  setDropDay(g.key);
                }
              : undefined
          }
          onDragLeave={canMove ? (e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropDay(null) : undefined}
          onDrop={canMove ? dropOn(g.day) : undefined}
        >
          {g.label && (
            <h3 className="m-0 flex items-center gap-2 px-1 text-xs font-medium text-[#d4d4d8]">
              {g.label}
              <span className="font-normal text-dim">{g.posts.length}</span>
            </h3>
          )}
          <div className="overflow-hidden rounded-[10px] border border-column-border bg-column">
            {g.posts.map((p) => (
              <PostRow
                key={p.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(p.id, el);
                  else rowRefs.current.delete(p.id);
                }}
                post={p}
                tab={tab.id}
                channel={channelById.get(p.channelId)}
                promoted={promoted[p.id]}
                selected={selected === p.id}
                highlight={p.id === highlightId}
                editing={editing === p.id}
                expanded={expanded.has(p.id)}
                busy={busy.has(p.id)}
                draggable={canMove && p.actions.includes("updatePostSchedule")}
                rescheduleOpen={rescheduling === p.id}
                onSelect={() => setSelected(p.id)}
                onToggle={() =>
                  setExpanded((s) => {
                    const n = new Set(s);
                    if (n.has(p.id)) n.delete(p.id);
                    else n.add(p.id);
                    return n;
                  })
                }
                onEdit={() => setEditing(p.id)}
                onCancelEdit={() => setEditing(null)}
                onSaveText={async (text) => {
                  if (await edit(p, { text }, "Post updated in Buffer")) setEditing(null);
                }}
                onRescheduleOpen={(o) => setRescheduling(o ? p.id : null)}
                onReschedule={(at) => reschedule(p, at)}
                onCopy={() => copy(p)}
                onDelete={() => setDeleting(p)}
                onPostAgain={() => onCompose(p.text)}
                onOpenArticle={(id) => goPost(id)}
              />
            ))}
          </div>
        </section>
      ))}

      {!loading && more && (
        <Button variant="outline" className="self-start" onClick={() => fetchPage(cursor)}>
          Load more
        </Button>
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Delete this post from Buffer?</DialogTitle>
            <DialogDescription>It's removed from Buffer{deleting?.status === "sent" ? ", but stays on the social network" : ""}. This can't be undone.</DialogDescription>
          </DialogHeader>
          {deleting && <p className="m-0 line-clamp-4 whitespace-pre-wrap rounded-md bg-[#0f0f11] p-3 text-xs text-[#d4d4d8]">{deleting.text}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!!deleting && busy.has(deleting.id)} onClick={() => deleting && remove(deleting)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


interface RowProps {
  post: BufferPost;
  tab: string;
  channel?: BufferChannel;
  promoted?: PromotedArticle;
  selected: boolean;
  highlight: boolean;
  editing: boolean;
  expanded: boolean;
  busy: boolean;
  draggable: boolean;
  rescheduleOpen: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveText: (text: string) => void;
  onRescheduleOpen: (open: boolean) => void;
  onReschedule: (at: Date) => void;
  onCopy: () => void;
  onDelete: () => void;
  onPostAgain: () => void;
  onOpenArticle: (postId: string) => void;
}

const PostRow = forwardRef<HTMLDivElement, RowProps>(function PostRow(
  {
    post: p,
    tab,
    channel,
    promoted,
    selected,
    highlight,
    editing,
    expanded,
    busy,
    draggable,
    rescheduleOpen,
    onSelect,
    onToggle,
    onEdit,
    onCancelEdit,
    onSaveText,
    onRescheduleOpen,
    onReschedule,
    onCopy,
    onDelete,
    onPostAgain,
    onOpenArticle,
  },
  ref,
) {
  const can = (a: string) => p.actions.includes(a);
  const t = postTime(p);
  const failed = p.status === "error";
  const canTime = can("updatePostSchedule") && p.status !== "sent";
  const long = p.text.length > LONG_TEXT || p.text.split("\n").length > 4;
  const channelName = channel?.displayName || channel?.name || serviceName(p.channelService);

  return (
    <div
      ref={ref}
      draggable={draggable && !editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, p.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onPointerDown={onSelect}
      aria-selected={selected}
      className={cn(
        "group relative flex gap-3 border-b border-column-border px-3 py-3 last:border-b-0 hover:bg-[#121215]",
        selected && "bg-[#141418] shadow-[inset_2px_0_0_#a1a1aa]",
        highlight && "shadow-[inset_2px_0_0_#60a5fa]",
        failed && "bg-[rgba(248,113,113,.04)]",
        busy && "opacity-60",
      )}
    >
      {/* Time column; the grip shows on rows that can be dragged to another day. */}
      <div className="flex w-[64px] shrink-0 flex-col items-start gap-0.5 pt-0.5">
        <span className={cn("font-mono text-[12px] tabular-nums", failed ? "text-overdue" : "text-[#d4d4d8]")}>
          {t ? (tab === "drafts" ? ago(t) : clock(t)) : "—"}
        </span>
        {draggable && <GripVertical aria-hidden className="size-3.5 cursor-grab text-[#3f3f46] opacity-0 group-hover:opacity-100" />}
      </div>

      <Avatar channel={channel} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
          <span className="text-[#d4d4d8]">{channelName}</span>
          {p.status === "sending" && <StatusChip color="#60a5fa">Sending</StatusChip>}
          {p.status === "needs_approval" && <StatusChip color="#f59e0b">Needs approval</StatusChip>}
          {failed && <StatusChip color="#f87171">Failed</StatusChip>}
          {p.author && <span>{p.author}</span>}
          {promoted && (
            <button
              className="inline-flex max-w-[260px] items-center gap-1 rounded-full border border-[#2e2e35] px-1.5 py-px text-[#c4b5fd] hover:border-[#52525b]"
              title="Open the article in Posts"
              onClick={() => onOpenArticle(promoted.postId)}
            >
              <FileText className="size-3 shrink-0" />
              <span className="truncate">Promotes “{promoted.title || "Untitled post"}”</span>
            </button>
          )}
          {p.tags.map((tag) => (
            <span key={tag.name} className="rounded-full border px-1.5 text-[10px]" style={{ borderColor: tag.color, color: tag.color }}>
              {tag.name}
            </span>
          ))}
        </div>

        {editing ? (
          <InlineEditor text={p.text} limit={LIMITS[p.channelService]} busy={busy} onCancel={onCancelEdit} onSave={onSaveText} />
        ) : (
          <>
            <p
              className={cn("m-0 cursor-text whitespace-pre-wrap text-[13px] leading-snug text-[#f4f4f5] selectable", !expanded && "line-clamp-4")}
              onDoubleClick={() => can("updatePost") && onEdit()}
              title={can("updatePost") ? "Double-click to edit" : undefined}
            >
              {p.text || <span className="text-dim">No text</span>}
            </p>
            {long && (
              <button className="self-start text-[11px] text-dim hover:text-strong" onClick={onToggle}>
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </>
        )}

        {p.images.length > 0 && (
          <div className="flex gap-1.5">
            {p.images.slice(0, 4).map((src) => (
              <img key={src} src={src} alt="" className="size-14 rounded-md object-cover" />
            ))}
          </div>
        )}

        {failed && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-[rgba(248,113,113,.3)] bg-[rgba(248,113,113,.08)] px-2.5 py-2 text-xs text-[#fca5a5]">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="min-w-0 grow">{p.error || "Buffer couldn't publish this post and gave no reason."}</span>
            {p.errorHelp && (
              <button className="underline" onClick={() => Browser.OpenURL(p.errorHelp)}>
                Help
              </button>
            )}
            {canTime ? (
              <Reschedule channel={channel} current={t} open={rescheduleOpen} onOpenChange={onRescheduleOpen} onPick={onReschedule} label="Retry" primary />
            ) : (
              <Button size="sm" onClick={onPostAgain}>
                <RotateCcw className="size-3" /> Post again
              </Button>
            )}
          </div>
        )}

        {!editing && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
              (selected || rescheduleOpen) && "opacity-100",
            )}
          >
            {can("updatePost") && (
              <RowAction icon={<Pencil className="size-3" />} label="Edit" kbd="E" onClick={onEdit} />
            )}
            {canTime && !failed && (
              <Reschedule channel={channel} current={t} open={rescheduleOpen} onOpenChange={onRescheduleOpen} onPick={onReschedule} label="Reschedule" />
            )}
            <RowAction icon={<Copy className="size-3" />} label="Copy text" kbd="C" onClick={onCopy} />
            {tab === "sent" && p.text && <RowAction icon={<RotateCcw className="size-3" />} label="Post again" onClick={onPostAgain} />}
            {p.externalLink && <RowAction icon={<ExternalLink className="size-3" />} label="View post" onClick={() => Browser.OpenURL(p.externalLink)} />}
            {can("deletePost") && (
              <RowAction icon={<Trash2 className="size-3" />} label="Delete" kbd="⌫" onClick={onDelete} className="ml-auto hover:text-overdue" />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function StatusChip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px]" style={{ color, background: `${color}1f` }}>
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

function RowAction({ icon, label, kbd, onClick, className }: { icon: React.ReactNode; label: string; kbd?: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      title={kbd ? `${label}  (${kbd})` : label}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-[#1c1c20] hover:text-strong", className)}
    >
      {icon}
      {label}
    </button>
  );
}

/** Reschedule menu: the channel's next slot, quick picks and an exact time. */
function Reschedule({
  channel,
  current,
  open,
  onOpenChange,
  onPick,
  label,
  primary,
}: {
  channel?: BufferChannel;
  current: Date | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (at: Date) => void;
  label: string;
  primary?: boolean;
}) {
  const now = new Date();
  const slot = nextSlotAt(channel, now);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(current ? current.getHours() : 9, current ? current.getMinutes() : 0, 0, 0);
  const inHour = new Date(Math.ceil((now.getTime() + 3_600_000) / 300_000) * 300_000);
  const nextWeek = current && current > now ? new Date(current.getTime() + 7 * 86_400_000) : null;
  const [exact, setExact] = useState(() => localInput(slot ?? inHour));

  const picks: { label: string; at: Date }[] = [
    ...(slot ? [{ label: `Next slot · ${dayLabel(slot).replace(/ · .*/, "")} ${clock(slot)}`, at: slot }] : []),
    { label: `In an hour · ${clock(inHour)}`, at: inHour },
    { label: `Tomorrow · ${clock(tomorrow)}`, at: tomorrow },
    ...(nextWeek ? [{ label: `A week later · ${nextWeek.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`, at: nextWeek }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {primary ? (
          <Button size="sm">
            <RotateCcw className="size-3" /> {label}
            <ChevronDown className="size-3" />
          </Button>
        ) : (
          <button
            title={`${label}  (R)`}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-[#1c1c20] hover:text-strong data-[state=open]:bg-[#1c1c20] data-[state=open]:text-strong"
          >
            <Clock className="size-3" /> {label}
            <ChevronDown className="size-3" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-[280px] flex-col gap-1 p-1.5">
        {picks.map((pk) => (
          <button key={pk.label} className="rounded-md px-2.5 py-1.5 text-left text-[13px] text-[#e4e4e7] hover:bg-[#1c1c20]" onClick={() => onPick(pk.at)}>
            {pk.label}
          </button>
        ))}
        <form
          className="mt-1 flex gap-1.5 border-t border-border px-1 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const at = new Date(exact);
            if (!isNaN(at.getTime())) onPick(at);
          }}
        >
          <Input type="datetime-local" value={exact} onChange={(e) => setExact(e.target.value)} className="h-8 grow text-xs" aria-label="Exact time" />
          <Button size="sm" type="submit" aria-label="Set time">
            <Check className="size-3" />
          </Button>
        </form>
        {channel?.timezone && <p className="m-0 px-2 pb-1 text-[11px] text-dim">Slots follow {channelTz(channel)}.</p>}
      </PopoverContent>
    </Popover>
  );
}

const channelTz = (c: BufferChannel) => c.timezone.replace(/_/g, " ");

/** The post's text, edited in place: ⌘↵ saves, Esc cancels. */
function InlineEditor({ text, limit, busy, onCancel, onSave }: { text: string; limit?: number; busy: boolean; onCancel: () => void; onSave: (t: string) => void }) {
  const [value, setValue] = useState(text);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const over = limit ? value.length > limit : false;
  const changed = value !== text && value.trim() !== "";
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={box}
        aria-label="Post text"
        value={value}
        rows={Math.min(12, Math.max(3, value.split("\n").length + 1))}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && changed && !over) {
            e.preventDefault();
            onSave(value);
          }
        }}
        className="w-full resize-y rounded-md border border-border-strong bg-[#0f0f11] p-2.5 text-[13px] leading-snug text-[#f4f4f5] outline-none focus:border-[#52525b]"
      />
      <div className="flex items-center gap-2 text-[11px] text-dim">
        <span className={cn("tabular-nums", over && "text-overdue")}>
          {value.length}
          {limit ? ` / ${limit}` : ""}
        </span>
        <span>⌘↵ to save · Esc to cancel</span>
        <span className="grow" />
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!changed || over || busy} onClick={() => onSave(value)}>
          {busy && <Loader2 className="size-3 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}
