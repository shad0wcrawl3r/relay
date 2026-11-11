import { useCallback, useEffect, useMemo, useState } from "react";
import { Events } from "@wailsio/runtime";
import { loadPref, savePref } from "@/lib/prefs";
import { PostList } from "@/views/buffer/Queue";
import { AlertTriangle, ExternalLink, FileText, Lightbulb, Loader2, Pause, PenLine, RefreshCw, Unplug } from "lucide-react";
import {
  BufferService,
  PostService,
  type BufferChannel,
  type BufferIdea,
  type BufferOverview,
  type BufferPostStatus,
} from "@/lib/api";
import { ago } from "@/lib/time";
import { cn, errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IdeaDialog } from "@/components/IdeaDialog";
import { ComposeDialog } from "@/components/ComposeDialog";
import { IdeasInBufferNote, SyncNote, openIdeasInBuffer } from "@/components/SyncNote";
import { addIdea, loadIdeas, loadMoreIdeas, useIdeas } from "@/lib/ideas";
import { EmptyState, Page, SkeletonRows } from "@/components/Page";
import { BufferTeamNote } from "@/components/BufferTeamNote";

type TabId = "queue" | "approval" | "drafts" | "sent" | "failed" | "ideas";

/** A post to show when the tab opens, e.g. from an article's promotions. */
export interface BufferFocus {
  postId: string;
  status: string;
}

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
export const serviceName = (s: string) => SERVICE_NAMES[s] ?? (s ? s[0].toUpperCase() + s.slice(1) : "");

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];


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

export function Avatar({ channel, size = 28 }: { channel?: BufferChannel; size?: number }) {
  if (channel?.avatar) return <img src={channel.avatar} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-[#232328] text-[11px] text-muted-foreground" style={{ width: size, height: size }}>
      {serviceName(channel?.service ?? "?")[0]}
    </span>
  );
}

const TAB_KEY = "relay.buffer.tab";
const CHANNEL_KEY = "relay.buffer.channel";
const TAB_IDS: TabId[] = ["queue", "approval", "drafts", "sent", "failed", "ideas"];

const tabFor = (status: string): TabId => TABS.find((t) => (t.statuses as string[]).includes(status))?.id ?? "queue";

export function Buffer({ goSettings, goPost, focus }: { goSettings: () => void; goPost: (postId: string) => void; focus?: BufferFocus }) {
  const toast = useToast();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<BufferOverview | null>(null);
  const [orgId, setOrgId] = useState("");
  const [tab, setTabState] = useState<TabId>(() => (focus ? tabFor(focus.status) : loadPref<TabId>(TAB_KEY, "queue", (v): v is TabId => typeof v === "string" && TAB_IDS.includes(v as TabId))));
  const setTab = (t: TabId) => {
    setTabState(t);
    savePref(TAB_KEY, t);
  };
  const [channelFilter, setChannelFilterState] = useState(() => (focus ? "" : loadPref<string>(CHANNEL_KEY, "")));
  const setChannelFilter = (next: string | ((f: string) => string)) =>
    setChannelFilterState((cur) => {
      const v = typeof next === "function" ? next(cur) : next;
      savePref(CHANNEL_KEY, v || undefined);
      return v;
    });
  // Failed posts from the 15-minute check (bufferwatch.go); no extra Buffer call.
  const [failedCount, setFailedCount] = useState(0);
  useEffect(() => {
    BufferService.LastFailed().then((f) => setFailedCount(f.length), () => {});
    return Events.On("buffer:failed", (ev) => setFailedCount(((ev.data as { all?: unknown[] | null })?.all ?? []).length));
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  // The composer's starting text while it's open; null when closed.
  const [composing, setComposing] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);

  const show = useCallback((o: BufferOverview) => {
    setOverview(o);
    setOrgId((cur) => (o.organizations.some((g) => g.id === cur) ? cur : (o.organizations[0]?.id ?? "")));
  }, []);

  // Opens on the cached overview, then fetches a fresh one.
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const cached = await BufferService.Cached();
      setConnected(cached.connected);
      if (!cached.connected) return;
      if (cached.overview) show(cached.overview);
      show(await BufferService.Overview());
    } catch (err) {
      // Buffer may have ended the sign-in during the fetch.
      const still = await BufferService.Cached().catch(() => null);
      if (still && !still.connected) setConnected(false);
      else setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!focus) return;
    setTabState(tabFor(focus.status));
    setChannelFilterState("");
  }, [focus]);

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
      <Page title="Buffer" subtitle="See your queue, sent posts, drafts and ideas in one place.">
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
      </Page>
    );
  }

  return (
    <Page
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

      {overview?.staff && <BufferTeamNote />}

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
                {t.id === "failed" && failedCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-[#3b1a1a] px-1.5 py-px text-[10px] text-[#fecaca]" aria-label={`${failedCount} failed`}>
                    {failedCount}
                  </span>
                )}
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
            <Ideas key={orgId} orgId={orgId} onWrite={(text) => setComposing(text)} goPost={goPost} />
          ) : (
            <PostList
              key={`${orgId}:${tab}:${channelFilter}:${sentCount}`}
              orgId={orgId}
              tab={TABS.find((t) => t.id === tab)!}
              channelIds={channelFilter ? [channelFilter] : []}
              channelById={channelById}
              highlightId={focus?.postId}
              onCompose={(text) => setComposing(text)}
              goPost={goPost}
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
    </Page>
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

function Ideas({ orgId, onWrite, goPost }: { orgId: string; onWrite: (text: string) => void; goPost: (postId: string) => void }) {
  const toast = useToast();
  const [starting, setStarting] = useState("");

  // An idea worth more than a social post: start a Dev.to article from it.
  const startArticle = async (i: BufferIdea) => {
    setStarting(i.id);
    try {
      const p = await PostService.CreateFromIdea(i.title, i.text);
      toast({ tone: "success", title: "Article started", body: "It's a local draft. Nothing goes to Dev.to until you send it." });
      goPost(p.id);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't start the article", body: errorMessage(err) });
    } finally {
      setStarting("");
    }
  };
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
      <IdeasInBufferNote />
      {error && <p className="text-xs text-overdue">{error}</p>}
      {current && !loading && !error && ideas.length === 0 && <EmptyState title="No ideas yet." body="Save one from quick capture (⌘K), or from a Plane board's ideas column." />}
      {loading && ideas.length === 0 && <SkeletonRows label="Loading ideas" />}
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
                    <span className="ml-auto inline-flex items-center gap-2.5">
                      <button className="inline-flex items-center gap-1 text-dim hover:text-strong" onClick={openIdeasInBuffer} title="Edit or delete it in Buffer">
                        <ExternalLink className="size-3" /> Open in Buffer
                      </button>
                      <button
                        className="inline-flex items-center gap-1 text-dim hover:text-strong"
                        onClick={() => onWrite([i.title, i.text].filter(Boolean).join("\n\n"))}
                      >
                        <PenLine className="size-3" /> Write a post
                      </button>
                      <button
                        className="inline-flex items-center gap-1 text-dim hover:text-strong disabled:opacity-50"
                        disabled={!!starting}
                        title="Start a Dev.to article from this idea, in the editor"
                        onClick={() => startArticle(i)}
                      >
                        {starting === i.id ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />} Write an article
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      {loading && ideas.length > 0 ? (
        <p className="flex items-center gap-2 px-1 text-xs text-dim">
          <Loader2 className="size-3.5 animate-spin" /> Refreshing…
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
