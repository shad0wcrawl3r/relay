import { useCallback, useEffect, useMemo, useState } from "react";
import { Browser } from "@wailsio/runtime";
import { AlertTriangle, ExternalLink, Lightbulb, Loader2, Pause, Pencil, PenLine, RefreshCw, Trash2, Unplug } from "lucide-react";
import {
  BufferService,
  type BufferChannel,
  type BufferOverview,
  type BufferPost,
  type BufferPostStatus,
} from "@/lib/api";
import { ago } from "@/lib/time";
import { cn, errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IdeaDialog } from "@/components/IdeaDialog";
import { ComposeDialog } from "@/components/ComposeDialog";
import { SyncNote } from "@/components/SyncNote";
import { addIdea, loadIdeas, loadMoreIdeas, useIdeas } from "@/lib/ideas";

type TabId = "queue" | "approval" | "drafts" | "sent" | "failed" | "ideas";

const TABS: { id: TabId; label: string; statuses: BufferPostStatus[]; empty: string }[] = [
  { id: "queue", label: "Queue", statuses: ["scheduled", "sending"], empty: "Nothing is scheduled." },
  { id: "approval", label: "Awaiting approval", statuses: ["needs_approval"], empty: "Nothing is waiting for approval." },
  { id: "drafts", label: "Drafts", statuses: ["draft"], empty: "No drafts." },
  { id: "sent", label: "Sent", statuses: ["sent"], empty: "Nothing sent yet." },
  { id: "failed", label: "Failed", statuses: ["error"], empty: "No failed posts." },
];

const SERVICE_NAMES: Record<string, string> = {
  twitter: "X",
  linkedin: "LinkedIn",
  googlebusiness: "Google Business",
  startPage: "Start Page",
  tiktok: "TikTok",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
};
const serviceName = (s: string) => SERVICE_NAMES[s] ?? (s ? s[0].toUpperCase() + s.slice(1) : "");

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const when = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** The next posting slot in the channel's schedule, as text in its timezone. */
function nextSlot(c: BufferChannel): string {
  const days = c.postingSchedule.filter((d) => !d.paused && d.times.length > 0);
  if (days.length === 0) return "";
  let now: Date;
  try {
    now = new Date(new Date().toLocaleString("en-US", { timeZone: c.timezone || undefined }));
  } catch {
    now = new Date();
  }
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  for (let offset = 0; offset < 8; offset++) {
    const day = DAYS[(now.getDay() + offset) % 7];
    const sched = days.find((d) => d.day.toLowerCase().startsWith(day));
    const t = sched?.times.slice().sort().find((t) => offset > 0 || t > hhmm);
    if (t) return `${offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : day[0].toUpperCase() + day.slice(1)} ${t}`;
  }
  return "";
}

const GOAL_COLOR: Record<string, string> = { Hit: "#46a758", OnTrack: "#60a5fa", AtRisk: "#f59e0b" };
const GOAL_LABEL: Record<string, string> = { Hit: "Goal hit", OnTrack: "On track", AtRisk: "At risk" };

function Avatar({ channel, size = 28 }: { channel?: BufferChannel; size?: number }) {
  if (channel?.avatar) return <img src={channel.avatar} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-[#232328] text-[11px] text-muted-foreground" style={{ width: size, height: size }}>
      {serviceName(channel?.service ?? "?")[0]}
    </span>
  );
}

export function Buffer({ goSettings }: { goSettings: () => void }) {
  const toast = useToast();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<BufferOverview | null>(null);
  const [orgId, setOrgId] = useState("");
  const [tab, setTab] = useState<TabId>("queue");
  const [channelFilter, setChannelFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  // The composer's starting text while it's open; null when closed.
  const [composing, setComposing] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const st = await BufferService.Status();
      setConnected(st.connected);
      if (!st.connected) return;
      const o = await BufferService.Overview();
      setOverview(o);
      setOrgId((cur) => (o.organizations.some((g) => g.id === cur) ? cur : (o.organizations[0]?.id ?? "")));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const connect = async () => {
    setConnecting(true);
    try {
      await BufferService.Connect();
      await load();
    } catch (err) {
      toast({ tone: "error", title: "Couldn't sign in to Buffer", body: errorMessage(err) });
    } finally {
      setConnecting(false);
    }
  };

  const org = overview?.organizations.find((o) => o.id === orgId);
  const channels = useMemo(() => (overview?.channels ?? []).filter((c) => c.organizationId === orgId || !c.organizationId), [overview, orgId]);
  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  if (connected === false) {
    return (
      <Shell title="Buffer" subtitle="See your queue, sent posts, drafts and ideas in one place.">
        <div className="flex max-w-[460px] flex-col items-start gap-3 rounded-[10px] border border-column-border bg-column p-5">
          <p className="m-0 text-[13px] text-[#d4d4d8]">Sign in to Buffer to see your channels and posts here. Relay keeps the sign-in in your OS keychain.</p>
          <div className="flex gap-2">
            <Button onClick={connect} disabled={connecting}>
              {connecting && <Loader2 className="size-3.5 animate-spin" />}
              {connecting ? "Waiting for Buffer…" : "Sign in to Buffer"}
            </Button>
            <Button variant="outline" onClick={goSettings}>
              Settings
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      title="Buffer"
      subtitle={overview ? `${overview.account} · ${channels.length} channel${channels.length === 1 ? "" : "s"}` : loading ? "Loading…" : ""}
      actions={
        <div className="flex items-center gap-2">
          {(overview?.organizations.length ?? 0) > 1 && (
            <select
              aria-label="Organization"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="h-[30px] rounded-md border border-border bg-[#111113] px-2 text-xs text-[#d4d4d8]"
            >
              {overview!.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          {overview && orgId && (
            <Button onClick={() => setComposing("")}>
              <PenLine className="size-3.5" /> New post
            </Button>
          )}
          <Button variant="outline" size="icon" aria-label="Refresh" onClick={load} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      }
    >
      {error && (
        <p className="mb-4 flex items-center gap-2 text-xs text-overdue">
          <AlertTriangle className="size-3.5" /> {error}
        </p>
      )}

      {channels.length > 0 && (
        <section aria-label="Channels" className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
          {channels.map((c) => (
            <ChannelCard key={c.id} channel={c} active={channelFilter === c.id} onClick={() => setChannelFilter((f) => (f === c.id ? "" : c.id))} />
          ))}
        </section>
      )}

      {overview && orgId && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
          <TabsList className="mb-4">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="ideas">Ideas</TabsTrigger>
            {channelFilter && (
              <button className="ml-auto text-xs text-dim hover:text-strong" onClick={() => setChannelFilter("")}>
                Showing {channelById.get(channelFilter)?.displayName || channelById.get(channelFilter)?.name} · show all
              </button>
            )}
          </TabsList>
          {tab === "ideas" ? (
            <Ideas key={orgId} orgId={orgId} onWrite={(text) => setComposing(text)} />
          ) : (
            <PostList
              key={`${orgId}:${tab}:${channelFilter}:${sentCount}`}
              orgId={orgId}
              tab={TABS.find((t) => t.id === tab)!}
              channelIds={channelFilter ? [channelFilter] : []}
              channelById={channelById}
            />
          )}
        </Tabs>
      )}

      {composing !== null && (
        <ComposeDialog
          channels={channels}
          initialText={composing}
          onClose={() => setComposing(null)}
          onSent={() => setSentCount((n) => n + 1)}
        />
      )}

      {org && (
        <p className="mt-8 text-[11px] text-dim">
          {org.name} plan: up to {org.limits.channels} channels, {org.limits.scheduledPosts} scheduled posts and {org.limits.ideas} ideas. Post
          metrics aren't shown: Buffer only offers them to personal API keys.
        </p>
      )}
    </Shell>
  );
}

function Shell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="drag h-10 shrink-0" />
      <div className="mx-auto flex max-w-[980px] flex-col px-8 pb-10">
        <div className="mb-6 flex items-end gap-4">
          <div className="flex-1">
            <h1 className="m-0 text-[22px] font-semibold tracking-[-.01em] text-strong">{title}</h1>
            {subtitle && <p className="mt-1 text-[13px] text-dim">{subtitle}</p>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </main>
  );
}

function ChannelCard({ channel: c, active, onClick }: { channel: BufferChannel; active: boolean; onClick: () => void }) {
  const goal = c.postingGoal;
  const slot = nextSlot(c);
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col gap-2 rounded-[10px] border border-column-border bg-column p-3 text-left hover:border-border-strong",
        active && "border-[#52525b] bg-[#141417]",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Avatar channel={c} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-[#f4f4f5]">{c.displayName || c.name}</div>
          <div className="truncate text-[11px] text-dim">{c.descriptor || serviceName(c.service)}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dim">
        {c.isDisconnected && (
          <span className="inline-flex items-center gap-1 text-overdue">
            <Unplug className="size-3" /> Reconnect in Buffer
          </span>
        )}
        {c.isQueuePaused && (
          <span className="inline-flex items-center gap-1 text-[#fbbf24]">
            <Pause className="size-3" /> Queue paused
          </span>
        )}
        {goal && goal.goal > 0 && (
          <span className="inline-flex items-center gap-1" title="Weekly posting goal">
            <span className="size-1.5 rounded-full" style={{ background: GOAL_COLOR[goal.status] ?? "#71717a" }} />
            {goal.sentCount + goal.scheduledCount}/{goal.goal} this week · {GOAL_LABEL[goal.status] ?? goal.status}
          </span>
        )}
        {slot && !c.isQueuePaused && <span>Next slot {slot}</span>}
      </div>
    </button>
  );
}

function PostList({
  orgId,
  tab,
  channelIds,
  channelById,
}: {
  orgId: string;
  tab: (typeof TABS)[number];
  channelIds: string[];
  channelById: Map<string, BufferChannel>;
}) {
  const toast = useToast();
  const [posts, setPosts] = useState<BufferPost[]>([]);
  const [cursor, setCursor] = useState("");
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<BufferPost | null>(null);
  const [deleting, setDeleting] = useState<BufferPost | null>(null);

  const fetchPage = useCallback(
    async (after: string) => {
      setLoading(true);
      setError("");
      try {
        const page = await BufferService.Posts({ organizationId: orgId, statuses: tab.statuses, channelIds, after });
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
  }, [fetchPage]);

  const remove = async (p: BufferPost) => {
    try {
      await BufferService.DeletePost(p.id);
      setPosts((cur) => cur.filter((x) => x.id !== p.id));
      toast({ tone: "success", title: "Post deleted from Buffer" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the post", body: errorMessage(err) });
    } finally {
      setDeleting(null);
    }
  };

  if (error) return <p className="text-xs text-overdue">{error}</p>;
  if (!loading && posts.length === 0) return <p className="px-1 text-[13px] text-dim">{tab.empty}</p>;

  return (
    <div className="flex flex-col gap-3">
      {posts.length > 0 && (
        <div className="overflow-hidden rounded-[10px] border border-column-border bg-column">
          {posts.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              channel={channelById.get(p.channelId)}
              onEdit={() => setEditing(p)}
              onDelete={() => setDeleting(p)}
            />
          ))}
        </div>
      )}
      {loading ? (
        <p className="flex items-center gap-2 px-1 text-xs text-dim">
          <Loader2 className="size-3.5 animate-spin" /> Loading posts…
        </p>
      ) : (
        more && (
          <Button variant="outline" className="self-start" onClick={() => fetchPage(cursor)}>
            Load more
          </Button>
        )
      )}
      {editing && (
        <EditDialog
          post={editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setPosts((cur) => cur.map((x) => (x.id === p.id ? p : x)));
            setEditing(null);
          }}
        />
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
            <Button variant="destructive" onClick={() => deleting && remove(deleting)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PostRow({ post: p, channel, onEdit, onDelete }: { post: BufferPost; channel?: BufferChannel; onEdit: () => void; onDelete: () => void }) {
  const can = (a: string) => p.actions.includes(a);
  const time =
    p.status === "sent"
      ? `Sent ${ago(p.sentAt || p.dueAt)}`
      : p.status === "draft"
        ? `Created ${ago(p.createdAt)}`
        : p.dueAt
          ? `${p.status === "error" ? "Was due" : "Due"} ${when(p.dueAt)}`
          : "No time set";
  return (
    <div className="flex gap-3 border-b border-column-border px-3.5 py-3 last:border-b-0 hover:bg-[#121215]">
      <Avatar channel={channel} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2 text-[11px] text-dim">
          <span className="text-[#d4d4d8]">{channel?.displayName || channel?.name || serviceName(p.channelService)}</span>
          <span>·</span>
          <span>{time}</span>
          {p.author && <span>· {p.author}</span>}
          {p.tags.map((t) => (
            <span key={t.name} className="rounded-full border px-1.5 text-[10px]" style={{ borderColor: t.color, color: t.color }}>
              {t.name}
            </span>
          ))}
        </div>
        <p className="m-0 line-clamp-3 whitespace-pre-wrap text-[13px] leading-snug text-[#f4f4f5]">{p.text || <span className="text-dim">No text</span>}</p>
        {p.images.length > 0 && (
          <div className="mt-1 flex gap-1.5">
            {p.images.slice(0, 4).map((src) => (
              <img key={src} src={src} alt="" className="size-12 rounded-md object-cover" />
            ))}
          </div>
        )}
        {p.error && (
          <p className="m-0 flex items-center gap-1.5 text-xs text-overdue">
            <AlertTriangle className="size-3.5 shrink-0" />
            {p.error}
            {p.errorHelp && (
              <button className="underline" onClick={() => Browser.OpenURL(p.errorHelp)}>
                Help
              </button>
            )}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-1">
        {p.externalLink && (
          <Button variant="ghost" size="icon" aria-label="Open the post" onClick={() => Browser.OpenURL(p.externalLink)}>
            <ExternalLink className="size-3.5" />
          </Button>
        )}
        {(can("updatePost") || can("updatePostSchedule")) && (
          <Button variant="ghost" size="icon" aria-label="Edit" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
        )}
        {can("deletePost") && (
          <Button variant="ghost" size="icon" aria-label="Delete" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

const localInput = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function EditDialog({ post, onClose, onSaved }: { post: BufferPost; onClose: () => void; onSaved: (p: BufferPost) => void }) {
  const toast = useToast();
  const canText = post.actions.includes("updatePost");
  const canTime = post.actions.includes("updatePostSchedule") && post.status !== "sent";
  const [text, setText] = useState(post.text);
  const [due, setDue] = useState(localInput(post.dueAt));
  const [saving, setSaving] = useState(false);
  const timeChanged = canTime && due !== localInput(post.dueAt);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await BufferService.EditPost(post.id, text, timeChanged && due ? new Date(due).toISOString() : "");
      toast({ tone: "success", title: "Post updated in Buffer" });
      onSaved(saved);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't update the post", body: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-w-[560px] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Edit post</DialogTitle>
          <DialogDescription>Changes go straight to Buffer. A post Relay sent about an article keeps its Dev.to link.</DialogDescription>
        </DialogHeader>
        <textarea
          aria-label="Post text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!canText}
          rows={8}
          className="w-full resize-y rounded-md border border-border bg-[#0f0f11] p-3 text-[13px] leading-snug text-[#f4f4f5] outline-none focus:border-border-strong"
        />
        {canTime && (
          <label className="flex items-center gap-3 text-xs text-muted-foreground">
            Time
            <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="w-auto" />
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !text.trim() || (text === post.text && !timeChanged)}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Ideas({ orgId, onWrite }: { orgId: string; onWrite: (text: string) => void }) {
  const toast = useToast();
  const { ideas, groups, links, more, loading, error, orgId: loadedOrg } = useIdeas(true, orgId);
  const [composing, setComposing] = useState(false);
  const current = loadedOrg === orgId;

  const sections = useMemo(() => {
    const name = (id: string) => groups.find((g) => g.id === id)?.name ?? "Other";
    const order = ["", ...groups.map((g) => g.id)];
    const known = new Set(order);
    return [...order, "?"]
      .map((id) => ({
        id,
        name: id === "" ? "Unassigned" : id === "?" ? "Other groups" : name(id),
        ideas: ideas.filter((i) => (id === "?" ? !known.has(i.groupId || "") : (i.groupId || "") === id)),
      }))
      .filter((s) => s.ideas.length > 0);
  }, [ideas, groups]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button onClick={() => setComposing(true)}>
          <Lightbulb className="size-3.5" /> New idea
        </Button>
        <SyncNote />
        <Button variant="ghost" size="icon" aria-label="Reload ideas" onClick={() => loadIdeas(orgId, true)} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>
      {error && <p className="text-xs text-overdue">{error}</p>}
      {current && !loading && !error && ideas.length === 0 && <p className="px-1 text-[13px] text-dim">No ideas yet.</p>}
      {current &&
        sections.map((s) => (
          <section key={s.id} aria-label={s.name}>
            <div className="mb-2 px-1 text-xs font-medium text-[#d4d4d8]">
              {s.name} <span className="font-normal text-dim">{s.ideas.length}</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
              {s.ideas.map((i) => (
                <div key={i.id} className="flex flex-col gap-1.5 rounded-[10px] border border-column-border bg-column p-3">
                  {i.title && <div className="text-[13px] font-medium text-[#f4f4f5]">{i.title}</div>}
                  {i.text && <p className="m-0 line-clamp-5 whitespace-pre-wrap text-xs leading-snug text-[#d4d4d8]">{i.text}</p>}
                  <div className="mt-auto flex flex-wrap gap-x-2 text-[11px] text-dim">
                    {i.createdAt > 0 && <span>{ago(new Date(i.createdAt > 1e12 ? i.createdAt : i.createdAt * 1000))}</span>}
                    {i.services.length > 0 && <span>· {i.services.map(serviceName).join(", ")}</span>}
                    {links[i.id] && <span className="text-[#93c5fd]">· In Plane as {links[i.id].key}</span>}
                    <button
                      className="ml-auto inline-flex items-center gap-1 text-dim hover:text-strong"
                      onClick={() => onWrite([i.title, i.text].filter(Boolean).join("\n\n"))}
                    >
                      <PenLine className="size-3" /> Write a post
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      {loading ? (
        <p className="flex items-center gap-2 px-1 text-xs text-dim">
          <Loader2 className="size-3.5 animate-spin" /> Loading ideas…
        </p>
      ) : (
        more &&
        current && (
          <Button variant="outline" className="self-start" onClick={loadMoreIdeas}>
            Load more
          </Button>
        )
      )}
      {composing && (
        <IdeaDialog
          orgId={orgId}
          groups={groups.filter((g) => !g.isLocked)}
          onClose={() => setComposing(false)}
          onCreated={(i) => {
            addIdea(i);
            setComposing(false);
            toast({ tone: "success", title: "Idea saved in Buffer" });
          }}
        />
      )}
    </div>
  );
}
