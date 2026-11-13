import { useCallback, useEffect, useState } from "react";
import { BarChart3, Link2, Loader2, RefreshCw } from "lucide-react";
import { BufferService, type Insights as InsightsT, type LinkCandidate, type Post } from "@/lib/api";
import { ago } from "@/lib/time";
import { errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// How a published post did: Dev.to's numbers (from the last sync, no extra
// call) and each promotion's metrics from Buffer, LinkedIn included. Buffer
// refreshes metrics once a day.

const fmt = (v: number, unit: string) => (unit === "percentage" ? `${v.toFixed(1)}%` : Intl.NumberFormat(undefined, { notation: "compact" }).format(v));

// Shown first, in this order, when Buffer reports them.
const ORDER = ["impressions", "reach", "views", "reactions", "comments", "shares", "reposts", "clicks", "engagementRate"];
const rank = (type: string) => {
  const i = ORDER.indexOf(type);
  return i < 0 ? ORDER.length : i;
};

type Linked = (p: Post) => void;

export function InsightsButton({ post, goSettings, onLinked }: { post: Post; goSettings: () => void; onLinked: Linked }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <BarChart3 className="size-3.5" /> Insights
      </Button>
      {open && <InsightsDialog post={post} onClose={() => setOpen(false)} goSettings={goSettings} onLinked={onLinked} />}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-[84px] flex-col gap-0.5 rounded-md border border-column-border bg-[#0f0f11] px-3 py-2">
      <span className="text-[15px] font-semibold text-strong">{value}</span>
      <span className="text-[11px] text-dim">{label}</span>
    </div>
  );
}

function InsightsDialog({ post, onClose, goSettings, onLinked }: { post: Post; onClose: () => void; goSettings: () => void; onLinked: Linked }) {
  const [data, setData] = useState<InsightsT | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setError("");
      try {
        setData(await BufferService.Insights(post.id, refresh));
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [post.id],
  );
  useEffect(() => {
    void load(false);
  }, [load]);

  const toSettings = () => {
    onClose();
    goSettings();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-4 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Insights · {post.title || "Untitled post"}</DialogTitle>
          <DialogDescription>Dev.to's numbers are from the last sync. Buffer updates its metrics once a day.</DialogDescription>
        </DialogHeader>

        {error && <p className="m-0 text-[13px] text-overdue">{error}</p>}
        {loading && !data && (
          <p className="m-0 flex items-center gap-2 text-[13px] text-dim">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </p>
        )}

        {data && (
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-[13px] font-semibold text-strong">Dev.to</h3>
              {data.devto ? (
                <div className="flex flex-wrap gap-2">
                  <Stat label="Views" value={fmt(data.devto.views, "count")} />
                  <Stat label="Reactions" value={fmt(data.devto.reactions, "count")} />
                  <Stat label="Comments" value={fmt(data.devto.comments, "count")} />
                </div>
              ) : (
                <p className="m-0 text-xs text-dim">Not in the last Dev.to sync yet.</p>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h3 className="m-0 grow text-[13px] font-semibold text-strong">Promotions</h3>
                {data.buffer !== "not-connected" && !linking && (
                  <Button variant="ghost" size="sm" onClick={() => setLinking(true)}>
                    <Link2 className="size-3.5" /> Link a Buffer post
                  </Button>
                )}
              </div>
              {linking && (
                <LinkPicker
                  postId={post.id}
                  onCancel={() => setLinking(false)}
                  onLinked={(p) => {
                    setLinking(false);
                    onLinked(p);
                    void load(true);
                  }}
                />
              )}
              {data.buffer === "none" && !linking && (
                <p className="m-0 text-xs text-dim">No promotions yet. Posted about it outside Promote? Link that Buffer post to see its numbers here.</p>
              )}
              {data.buffer === "not-connected" && <p className="m-0 text-xs text-dim">Connect Buffer in Settings → Publishing to see how promotions did.</p>}
              {(data.buffer === "needs-key" || data.buffer === "bad-key") && (
                <div className="flex flex-col gap-2 rounded-md border border-border bg-[#0f0f11] p-3 text-xs text-muted-foreground">
                  <span>
                    {data.buffer === "bad-key"
                      ? "Buffer refused the insights key. Check it in Settings → Publishing."
                      : "Buffer only shares post metrics with a personal API key, not with apps that sign in with OAuth. Add one to see impressions, reactions and clicks, LinkedIn included."}
                  </span>
                  <div>
                    <Button variant="outline" size="sm" onClick={toSettings}>
                      Open Settings → Publishing
                    </Button>
                  </div>
                </div>
              )}
              {data.buffer === "error" && <p className="m-0 text-xs text-overdue">Couldn't load Buffer's metrics: {data.bufferError}</p>}
              {data.buffer === "ok" &&
                data.promotions.map((p) => {
                  const metrics = [...p.metrics].sort((a, b) => rank(a.type) - rank(b.type));
                  return (
                    <div key={p.bufferId} className="flex flex-col gap-2 rounded-md border border-column-border px-3 py-2.5">
                      <div className="flex items-baseline gap-2 text-[13px]">
                        <span className="grow text-strong">{p.channel || p.service || "Buffer"}</span>
                        <span className="text-[11px] text-dim">{p.updatedAt ? `updated ${ago(p.updatedAt)}` : p.found ? "no metrics yet" : "no longer in Buffer"}</span>
                      </div>
                      {metrics.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {metrics.map((m) => (
                            <Stat key={m.type} label={m.name} value={fmt(m.value, m.unit)} />
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-dim">{p.found ? "Buffer shows metrics up to a day after a post goes out." : "Buffer deleted this post."}</span>
                      )}
                    </div>
                  );
                })}
            </section>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" size="md" disabled={loading} onClick={() => void load(true)}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// LinkPicker lists recent Buffer posts not linked to an article, ones that
// mention this article first, for a post made outside Promote.
function LinkPicker({ postId, onCancel, onLinked }: { postId: string; onCancel: () => void; onLinked: Linked }) {
  const toast = useToast();
  const [list, setList] = useState<LinkCandidate[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let live = true;
    BufferService.LinkCandidates(postId)
      .then((l) => live && setList(l))
      .catch((err) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [postId]);

  const link = async (c: LinkCandidate) => {
    setBusy(c.bufferId);
    try {
      onLinked(await BufferService.LinkPromotion(postId, c.bufferId));
      toast({ tone: "success", title: "Buffer post linked", body: "Its metrics show here once Buffer has them." });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't link the post", body: errorMessage(err) });
    } finally {
      setBusy("");
    }
  };

  const mentions = list?.filter((c) => c.mentions) ?? [];
  const others = list?.filter((c) => !c.mentions) ?? [];
  const row = (c: LinkCandidate) => (
    <li key={c.bufferId} className="flex items-start gap-3 rounded-md border border-column-border px-3 py-2">
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="text-[11px] text-dim">
          {c.channel || c.service || "Buffer"} · {c.status === "sent" ? `sent ${ago(c.sentAt)}` : c.dueAt ? `scheduled ${new Date(c.dueAt).toLocaleString()}` : c.status}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{c.text || "(no text)"}</span>
      </div>
      <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void link(c)}>
        {busy === c.bufferId ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Link
      </Button>
    </li>
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-[#0f0f11] p-3">
      <div className="flex items-center gap-2">
        <span className="grow text-xs text-strong">Recent Buffer posts not linked to an article</span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="m-0 text-xs text-overdue">{error}</p>}
      {!list && !error && (
        <p className="m-0 flex items-center gap-2 text-xs text-dim">
          <Loader2 className="size-3.5 animate-spin" /> Looking in Buffer…
        </p>
      )}
      {list && list.length === 0 && <p className="m-0 text-xs text-dim">No recent sent or scheduled posts that aren't linked already.</p>}
      {mentions.length > 0 && (
        <>
          <span className="text-[11px] font-medium text-muted-foreground">Mention this article</span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{mentions.map(row)}</ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <span className="text-[11px] font-medium text-muted-foreground">{mentions.length > 0 ? "Other recent posts" : "Recent posts (none has this article's link; Buffer may have shortened it)"}</span>
          <ul className="m-0 flex max-h-56 list-none flex-col gap-1.5 overflow-y-auto p-0">{others.map(row)}</ul>
        </>
      )}
    </div>
  );
}
