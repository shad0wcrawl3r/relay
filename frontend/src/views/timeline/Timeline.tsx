import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Browser } from "@wailsio/runtime";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Flag, Loader2, RefreshCw } from "lucide-react";
import {
  BufferService,
  PostService,
  type BufferChannel,
  type BufferOrganization,
  type CalendarPost,
  type CalendarPosts,
  type Item,
  type PostSummary,
  type Project,
} from "@/lib/api";
import { usePlane } from "@/lib/store";
import { useIntegrations } from "@/lib/integrations";
import { isDoneGroup, stateById } from "@/lib/plane";
import { ago, isoDate, parseDate, shortDate, startOfToday } from "@/lib/time";
import { cn, errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { serviceName, type BufferFocus } from "@/views/buffer/Buffer";
import type { OpenItem } from "@/App";

// Timeline: what Buffer will post, what's been published on Dev.to and
// what's due in Plane, by day. Each source is optional: it shows whatever
// is connected.
//
// Daily is one day in full. Weekly adds a strip of the week's days above
// it, with the weeks before and after peeking in, faded, to step to.

export type TimelineView = "daily" | "weekly";

const VIEWS: { id: TimelineView; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VIEW_KEY = "relay.timeline.view";
// Arrow clicks within this long of each other load once, for where they end up.
const SETTLE_MS = 350;

const STATUS: Record<string, { color: string; label: string }> = {
  scheduled: { color: "#60a5fa", label: "Scheduled" },
  sending: { color: "#60a5fa", label: "Sending" },
  needs_approval: { color: "#f59e0b", label: "Awaiting approval" },
  sent: { color: "#46a758", label: "Sent" },
  error: { color: "#ef4444", label: "Failed" },
};

type Entry =
  | { kind: "buffer"; at: Date; post: CalendarPost }
  | { kind: "article"; at: Date; post: PostSummary }
  | { kind: "due"; at: Date; item: Item; project: Project }
  | { kind: "cycle"; at: Date; edge: "starts" | "ends"; name: string; project: Project };

const dayStart = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const mondayOf = (d: Date) => addDays(dayStart(d), -((d.getDay() + 6) % 7));
const weekOf = (d: Date) => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(d), i));
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const longDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

/** The days a view loads around day: [from, to). Weekly includes the peeking weeks. */
function windowFor(view: TimelineView, day: Date): { from: Date; to: Date } {
  if (view === "daily") return { from: dayStart(day), to: addDays(dayStart(day), 1) };
  return { from: addDays(mondayOf(day), -7), to: addDays(mondayOf(day), 14) };
}

function savedView(): TimelineView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "daily" || v === "weekly") return v;
    if (v === "day") return "daily";
  } catch {
    // Storage can be unavailable; the default is fine.
  }
  return "weekly";
}

/** value, once it has stopped changing for ms. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export function Timeline({
  goBuffer,
  goPost,
  openItem,
}: {
  goBuffer: (focus?: BufferFocus) => void;
  goPost: (postId: string) => void;
  openItem: (o: OpenItem) => void;
}) {
  const { projects } = usePlane();
  const bufferOn = useIntegrations().buffer === true;
  const [view, setViewState] = useState<TimelineView>(savedView);
  const [day, setDay] = useState(() => startOfToday());
  const [orgs, setOrgs] = useState<BufferOrganization[]>([]);
  const [orgId, setOrgId] = useState("");
  const [channels, setChannels] = useState<BufferChannel[]>([]);
  const [buffer, setBuffer] = useState<CalendarPosts | null>(null);
  const [articles, setArticles] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Bumped by Refresh: the next load asks Buffer again instead of reusing lists.
  const [fresh, setFresh] = useState(0);
  const freshUsed = useRef(0);

  const setView = (v: TimelineView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Not remembered; nothing else depends on it.
    }
  };

  const { from, to } = useMemo(() => windowFor(view, day), [view, day]);
  const key = `${orgId}|${from.toISOString()}|${to.toISOString()}|${fresh}`;
  const settledKey = useSettled(key, SETTLE_MS);

  // Buffer's organizations and channels: the cached copy, then fresh ones
  // once per visit (and on Refresh), not per step.
  useEffect(() => {
    if (!bufferOn) return;
    let stale = false;
    const use = (o: { organizations: BufferOrganization[]; channels: BufferChannel[] }) => {
      if (stale) return;
      setOrgs(o.organizations);
      setChannels(o.channels);
      setOrgId((cur) => (o.organizations.some((g) => g.id === cur) ? cur : (o.organizations[0]?.id ?? "")));
    };
    BufferService.Cached()
      .then((c) => c.overview && use(c.overview))
      .catch(() => {});
    BufferService.Overview().then(use, (err) => !stale && setError(errorMessage(err)));
    return () => {
      stale = true;
    };
  }, [bufferOn, fresh]);

  // Loads only once the window has settled, so stepping quickly costs one load.
  useEffect(() => {
    if (!bufferOn || !orgId || settledKey !== key) return;
    let stale = false;
    const refresh = fresh !== freshUsed.current;
    freshUsed.current = fresh;
    setLoading(true);
    setError("");
    BufferService.Calendar(orgId, from.toISOString(), to.toISOString(), refresh)
      .then((c) => !stale && setBuffer(c))
      .catch((err) => !stale && setError(errorMessage(err)))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [settledKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    PostService.List().then((l) => setArticles(l.posts), () => {});
  }, [fresh]);

  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  // Everything by day. Buffer posts from an earlier window stay until the
  // new one loads; outside their days they simply don't show.
  const byDay = useMemo(() => {
    const entries: Entry[] = [];
    for (const p of buffer?.posts ?? []) {
      const at = parseDate(p.status === "sent" && p.sentAt ? p.sentAt : p.dueAt);
      if (at) entries.push({ kind: "buffer", at, post: p });
    }
    for (const a of articles) {
      const at = a.published ? parseDate(a.publishedAt) : null;
      if (at) entries.push({ kind: "article", at, post: a });
    }
    // Locked projects arrive empty; skip them anyway.
    for (const p of projects) {
      if (p.locked) continue;
      const states = stateById(p);
      for (const it of p.items) {
        const at = parseDate(it.targetDate);
        if (at && !isDoneGroup(states.get(it.stateId))) entries.push({ kind: "due", at, item: it, project: p });
      }
      for (const c of p.cycles) {
        const start = parseDate(c.startDate);
        const end = parseDate(c.endDate);
        if (start) entries.push({ kind: "cycle", at: dayStart(start), edge: "starts", name: c.name, project: p });
        if (end) entries.push({ kind: "cycle", at: dayStart(end), edge: "ends", name: c.name, project: p });
      }
    }
    // Plane dates have no time: they lead the day, then timed posts in order.
    const rank = (e: Entry) => (e.kind === "cycle" ? 0 : e.kind === "due" ? 1 : 2);
    entries.sort((a, b) => rank(a) - rank(b) || a.at.getTime() - b.at.getTime());
    const days = new Map<string, Entry[]>();
    for (const e of entries) {
      const k = isoDate(e.at);
      days.set(k, [...(days.get(k) ?? []), e]);
    }
    return days;
  }, [buffer, articles, projects]);

  const open = useCallback(
    (e: Entry) => {
      if (e.kind === "buffer") goBuffer({ postId: e.post.id, status: e.post.status });
      else if (e.kind === "article" && e.post.local) goPost(e.post.id);
      else if (e.kind === "due") openItem({ projectId: e.project.id, itemId: e.item.id });
    },
    [goBuffer, goPost, openItem],
  );

  const stepBy = view === "daily" ? 1 : 7;
  const today = startOfToday();
  const onToday = view === "daily" ? isoDate(day) === isoDate(today) : mondayOf(day).getTime() === mondayOf(today).getTime();
  const waiting = loading || (bufferOn && !!orgId && settledKey !== key);
  const nothing = !bufferOn && projects.length === 0 && articles.length === 0;
  const week = weekOf(day);

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="drag h-10 shrink-0" />
      <div className="mx-auto flex max-w-[980px] flex-col gap-4 px-8 pb-10">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-[22px] font-semibold tracking-[-.01em] text-strong">Timeline</h1>
            <p className="mt-1 text-[13px] text-dim">What's going out on Buffer, what's published on Dev.to and what's due in Plane.</p>
          </div>
          {orgs.length > 1 && (
            <select
              aria-label="Buffer organization"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="h-[30px] rounded-md border border-border bg-[#111113] px-2 text-xs text-[#d4d4d8]"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <div role="radiogroup" aria-label="View" className="inline-flex rounded-md border border-border p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="radio"
                aria-checked={view === v.id}
                onClick={() => setView(v.id)}
                className={cn("h-[26px] rounded px-3 text-xs text-muted-foreground hover:text-strong", view === v.id && "bg-[#1f1f23] text-strong")}
              >
                {v.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" aria-label="Refresh" title="Read Buffer again" onClick={() => setFresh((n) => n + 1)} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label={view === "daily" ? "Previous day" : "Previous week"} onClick={() => setDay((d) => addDays(d, -stepBy))}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button variant="outline" size="icon" aria-label={view === "daily" ? "Next day" : "Next week"} onClick={() => setDay((d) => addDays(d, stepBy))}>
            <ChevronRight className="size-3.5" />
          </Button>
          {!onToday && (
            <Button variant="ghost" onClick={() => setDay(startOfToday())}>
              {view === "daily" ? "Today" : "This week"}
            </Button>
          )}
          <h2 className="m-0 text-[15px] font-medium text-strong">
            {view === "daily" ? longDay(day) : `${shortDate(week[0])} – ${shortDate(week[6])}`}
          </h2>
          {waiting && <Loader2 className="size-3.5 animate-spin text-dim" />}
          {buffer?.loadedAt && !buffer.loadedAt.startsWith("0001") && (
            <span className="ml-auto text-[11px] text-dim" title="Buffer posts are reused for a few minutes. Refresh reads them again.">
              Buffer posts from {ago(buffer.loadedAt)}
            </span>
          )}
        </div>

        {error && <p className="m-0 text-xs text-overdue">{error}</p>}
        {buffer?.limited && <p className="m-0 text-xs text-[#f59e0b]">{buffer.limited}. Showing the posts Relay already has.</p>}
        {buffer?.partial && <p className="m-0 text-xs text-dim">This account has a lot of posts, so Relay read the first pages only. Some posts may be missing.</p>}
        {nothing && <p className="m-0 text-[13px] text-dim">Connect Plane, Buffer or Dev.to in Settings to fill the timeline.</p>}

        {view === "weekly" && (
          <WeekStrip day={day} byDay={byDay} onPick={(d) => setDay(dayStart(d))} onStep={(n) => setDay((d) => addDays(d, 7 * n))} />
        )}

        {view === "weekly" && <h3 className="m-0 text-[13px] font-medium text-[#d4d4d8]">{longDay(day)}</h3>}
        <DayList entries={byDay.get(isoDate(day)) ?? []} channelById={channelById} open={open} />

        <Legend />
      </div>
    </main>
  );
}

/** The week's days as small cards, with the weeks either side peeking in. */
function WeekStrip({
  day,
  byDay,
  onPick,
  onStep,
}: {
  day: Date;
  byDay: Map<string, Entry[]>;
  onPick: (d: Date) => void;
  onStep: (weeks: -1 | 1) => void;
}) {
  const week = weekOf(day);
  return (
    <div className="flex flex-col gap-1.5" aria-label="Week">
      <div className="grid grid-cols-7 gap-1.5 px-0.5 text-[11px] font-medium text-dim">
        {WEEKDAYS.map((d) => (
          <span key={d} className="px-1">
            {d}
          </span>
        ))}
      </div>
      <Peek days={weekOf(addDays(day, -7))} byDay={byDay} side="top" onClick={() => onStep(-1)} />
      <div className="grid grid-cols-7 gap-1.5">
        {week.map((d) => (
          <DayCardSmall key={isoDate(d)} day={d} entries={byDay.get(isoDate(d)) ?? []} selected={isoDate(d) === isoDate(day)} onClick={() => onPick(d)} />
        ))}
      </div>
      <Peek days={weekOf(addDays(day, 7))} byDay={byDay} side="bottom" onClick={() => onStep(1)} />
    </div>
  );
}

/** Half of a neighbouring week, faded toward the edge; clicking it steps there. */
function Peek({ days, byDay, side, onClick }: { days: Date[]; byDay: Map<string, Entry[]>; side: "top" | "bottom"; onClick: () => void }) {
  const label = side === "top" ? "Previous week" : "Next week";
  return (
    <button
      aria-label={`${label}, ${shortDate(days[0])} – ${shortDate(days[6])}`}
      title={label}
      onClick={onClick}
      className={cn(
        "relative block h-[38px] w-full overflow-hidden opacity-45 transition-opacity hover:opacity-80",
        side === "top"
          ? "[mask-image:linear-gradient(to_top,black_30%,transparent)]"
          : "[mask-image:linear-gradient(to_bottom,black_30%,transparent)]",
      )}
    >
      {/* The top peek shows the bottom half of its cards, the bottom peek the top half. */}
      <div className={cn("pointer-events-none absolute inset-x-0 grid grid-cols-7 gap-1.5", side === "top" ? "bottom-0" : "top-0")}>
        {days.map((d) => (
          <DayCardSmall key={isoDate(d)} day={d} entries={byDay.get(isoDate(d)) ?? []} selected={false} />
        ))}
      </div>
    </button>
  );
}

/** One day in the week strip: its date and what's on it, as counts. */
function DayCardSmall({ day, entries, selected, onClick }: { day: Date; entries: Entry[]; selected: boolean; onClick?: () => void }) {
  const today = isoDate(day) === isoDate(startOfToday());
  const posts = entries.filter((e): e is Extract<Entry, { kind: "buffer" }> => e.kind === "buffer");
  const failed = posts.filter((e) => e.post.status === "error").length;
  const articles = entries.filter((e) => e.kind === "article").length;
  const due = entries.filter((e) => e.kind === "due").length;
  const cycle = entries.some((e) => e.kind === "cycle");
  const parts = [
    posts.length > 0 && `${posts.length} post${posts.length === 1 ? "" : "s"}`,
    articles > 0 && `${articles} article${articles === 1 ? "" : "s"}`,
    due > 0 && `${due} due`,
  ].filter(Boolean);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      className={cn(
        "flex h-[76px] min-w-0 flex-col gap-1 rounded-[8px] border border-column-border bg-column p-2 text-left",
        onClick && "hover:border-[#3f3f46]",
        today && "border-[#52525b]",
        selected && "border-[#a1a1aa] bg-[#18181b]",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn("text-[15px] leading-none text-[#d4d4d8]", (today || selected) && "font-semibold text-strong")}>{day.getDate()}</span>
        {day.getDate() === 1 && <span className="text-[10px] text-dim">{shortDate(day).split(" ")[0]}</span>}
        {today && <span className="ml-auto text-[10px] font-medium text-[#60a5fa]">Today</span>}
        {cycle && !today && <Flag className="ml-auto size-3 text-muted-foreground" />}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {posts.slice(0, 6).map((e, i) => (
          <span key={i} className="size-1.5 rounded-full" style={{ background: (STATUS[e.post.status] ?? STATUS.scheduled).color }} />
        ))}
        {articles > 0 && <FileText className="size-3 text-[#5eead4]" />}
        {due > 0 && <span className="size-1.5 rounded-sm bg-[#71717a]" />}
      </div>
      <div className={cn("mt-auto truncate text-[10.5px] text-dim", failed > 0 && "text-overdue")}>
        {failed > 0 ? `${failed} failed` : parts.length ? parts.join(" · ") : "—"}
      </div>
    </Tag>
  );
}

/** The day in full: post text, articles, due items and cycles. */
function DayList({ entries, channelById, open }: { entries: Entry[]; channelById: Map<string, BufferChannel>; open: (e: Entry) => void }) {
  if (entries.length === 0) return <p className="m-0 rounded-[10px] border border-column-border bg-column px-4 py-6 text-center text-[13px] text-dim">Nothing on this day.</p>;
  return (
    <div className="flex flex-col gap-2">
      {entries.map((e, i) => (
        <DayCard key={i} entry={e} channelById={channelById} open={open} />
      ))}
    </div>
  );
}

function DayCard({ entry: e, channelById, open }: { entry: Entry; channelById: Map<string, BufferChannel>; open: (e: Entry) => void }) {
  const card = "flex gap-3 rounded-[10px] border border-column-border bg-column p-3";
  const when = "w-16 shrink-0 pt-0.5 text-xs text-dim";
  switch (e.kind) {
    case "buffer": {
      const ch = channelById.get(e.post.channelId);
      const st = STATUS[e.post.status] ?? STATUS.scheduled;
      return (
        <div className={card}>
          <div className={when}>{clock(e.at)}</div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {ch?.avatar && <img src={ch.avatar} alt="" className="size-5 rounded-full object-cover" />}
              <span className="text-[#e4e4e7]">{ch?.displayName || ch?.name || serviceName(e.post.channelService)}</span>
              <span className="text-dim">{serviceName(e.post.channelService)}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-px text-[11px]" style={{ color: st.color }}>
                <span className="size-1.5 rounded-full" style={{ background: st.color }} /> {st.label}
              </span>
            </div>
            <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[#d4d4d8]">{e.post.text || "(no text)"}</p>
            {e.post.error && <p className="m-0 text-xs text-overdue">{e.post.error}</p>}
            <div className="flex gap-3 text-xs">
              <button className="text-dim hover:text-strong" onClick={() => open(e)}>
                Show in Buffer tab
              </button>
              {e.post.externalLink && (
                <button className="inline-flex items-center gap-1 text-dim hover:text-strong" onClick={() => Browser.OpenURL(e.post.externalLink)}>
                  <ExternalLink className="size-3" /> View post
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    case "article":
      return (
        <div className={card}>
          <div className={when}>{clock(e.at)}</div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs text-[#5eead4]">
              <FileText className="size-3.5" /> Published on Dev.to
              {e.post.views > 0 && <span className="text-dim">· {e.post.views.toLocaleString()} views</span>}
            </div>
            <div className="text-[14px] font-medium text-strong">{e.post.title}</div>
            <div className="flex gap-3 text-xs">
              {e.post.local && (
                <button className="text-dim hover:text-strong" onClick={() => open(e)}>
                  Open in editor
                </button>
              )}
              {e.post.url && (
                <button className="inline-flex items-center gap-1 text-dim hover:text-strong" onClick={() => Browser.OpenURL(e.post.url)}>
                  <ExternalLink className="size-3" /> View on Dev.to
                </button>
              )}
            </div>
          </div>
        </div>
      );
    case "due": {
      const state = stateById(e.project).get(e.item.stateId);
      return (
        <button className={cn(card, "w-full text-left hover:border-[#3f3f46]")} onClick={() => open(e)}>
          <div className={when}>Due</div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2 text-xs text-dim">
              <span className="size-2 rounded-sm" style={{ background: e.project.color || "#71717a" }} />
              {e.project.name} · {e.item.key}
              {state && <span>· {state.name}</span>}
            </div>
            <div className="text-[14px] text-strong">{e.item.name}</div>
          </div>
        </button>
      );
    }
    case "cycle":
      return (
        <div className={card}>
          <div className={when}>All day</div>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground">
            <Flag className="size-3.5" />
            <span className="text-strong">{e.name}</span> {e.edge} · {e.project.name}
          </div>
        </div>
      );
  }
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-dim">
      {["scheduled", "needs_approval", "sent", "error"].map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full" style={{ background: STATUS[s].color }} /> {STATUS[s].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <FileText className="size-3 text-[#5eead4]" /> Published on Dev.to
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-1.5 rounded-sm bg-[#71717a]" /> Due in Plane
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Flag className="size-3" /> Cycle starts or ends
      </span>
    </div>
  );
}
