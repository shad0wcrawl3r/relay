import { useEffect, useRef, useState } from "react";
import { CancelError, type CancellablePromise } from "@wailsio/runtime";
import { Link2, Loader2, Sparkles } from "lucide-react";
import { AIService, BufferService, type AIStatus, type BufferChannel, type BufferTiming, type Post } from "@/lib/api";
import { cn, errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PostPreview, PREVIEW_NOTE } from "@/components/PostPreview";

const LINKEDIN_LIMIT = 3000;

const TIMINGS: { value: BufferTiming; label: string; done: string }[] = [
  { value: "queue", label: "Add to queue", done: "Added to your Buffer queue" },
  { value: "schedule", label: "Pick a time", done: "Scheduled in Buffer" },
  { value: "draft", label: "Save as draft", done: "Saved as a Buffer draft" },
];

const staticText = (post: Post) =>
  [
    post.title,
    post.series && `Part of my "${post.series}" series.`,
    post.description,
    post.tags.map((t) => `#${t}`).join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");

/** Tomorrow at 9am, in the format a datetime-local input expects. */
function defaultTime() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function PromoteDialog({
  open,
  onOpenChange,
  post,
  url,
  onPromoted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  post: Post;
  url: string;
  onPromoted: (post: Post) => void;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [channels, setChannels] = useState<BufferChannel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [ai, setAi] = useState<AIStatus | null>(null);
  const [text, setText] = useState("");
  const [timing, setTiming] = useState<BufferTiming>("queue");
  const [dueAt, setDueAt] = useState(defaultTime);
  const [summarizing, setSummarizing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<string | null>(null);
  const [evalNote, setEvalNote] = useState("");
  const summary = useRef<CancellablePromise<string> | null>(null);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setLoading(true);
    setError("");
    setReview(null);
    setText(staticText(post));
    setTiming("queue");
    setDueAt(defaultTime());
    AIService.Status().then((s) => !stale && setAi(s), () => {});
    BufferService.EvalNote().then((n) => !stale && setEvalNote(n), () => {});
    (async () => {
      try {
        const status = await BufferService.Status();
        if (stale) return;
        setConnected(status.connected);
        if (status.connected) {
          const linkedin = (await BufferService.Channels()).filter((c) => c.service === "linkedin");
          if (stale) return;
          setChannels(linkedin);
          setChannelId(linkedin[0]?.id ?? "");
        }
      } catch (err) {
        if (!stale) setError(errorMessage(err));
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
      summary.current?.cancel();
    };
    // Only reset when the dialog opens; post edits can't happen behind it.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const summarize = async () => {
    setSummarizing(true);
    setError("");
    const request = AIService.SummarizePost(post.id);
    summary.current = request;
    try {
      setText(await request);
    } catch (err) {
      if (!(err instanceof CancelError)) setError(errorMessage(err));
    } finally {
      summary.current = null;
      setSummarizing(false);
    }
  };

  const channel = channels.find((c) => c.id === channelId);
  const length =
    text.trim().length + (text.includes(url) ? 0 : url.length + 2) + (evalNote && !text.includes(evalNote) ? evalNote.length + 2 : 0);
  const tooLong = length > LINKEDIN_LIMIT;
  const ready = connected && channel && text.trim() && !tooLong && !summarizing && (timing !== "schedule" || dueAt);

  const startReview = async () => {
    setError("");
    try {
      setReview(await BufferService.PreviewPromotion(post.id, text));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const send = async () => {
    if (!channel) return;
    setSending(true);
    setError("");
    try {
      const updated = await BufferService.Promote({
        postId: post.id,
        channelId: channel.id,
        channel: channel.name,
        service: channel.service,
        text,
        timing,
        dueAt: timing === "schedule" ? new Date(dueAt).toISOString() : "0001-01-01T00:00:00Z",
      });
      onPromoted(updated);
      onOpenChange(false);
      toast({ tone: "success", title: TIMINGS.find((t) => t.value === timing)?.done ?? "Sent to Buffer", body: channel.name });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-[560px] flex-col gap-4" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{review === null ? "Promote on LinkedIn" : "Review your post"}</DialogTitle>
          <DialogDescription>{review === null ? (post.series ? `${post.title} · ${post.series}` : post.title) : whenText(timing, dueAt)}</DialogDescription>
        </DialogHeader>

        {review !== null && channel ? (
          <div className="flex flex-col gap-2">
            <div className="max-h-[52vh] overflow-y-auto">
              <PostPreview channel={channel} text={review} />
            </div>
            <p className="m-0 text-xs text-dim">{PREVIEW_NOTE}</p>
          </div>
        ) : loading ? (
          <div className="flex h-24 items-center justify-center gap-2 text-[13px] text-dim">
            <Loader2 className="size-3.5 animate-spin" />
            Loading your channels…
          </div>
        ) : !connected ? (
          <p className="m-0 text-[13px] text-muted-foreground">Connect Buffer in Settings → Publishing to promote this post.</p>
        ) : channels.length === 0 ? (
          <p className="m-0 text-[13px] text-muted-foreground">No LinkedIn channel found. Add one in Buffer, then try again.</p>
        ) : (
          <>
            {channels.length > 1 && (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="LinkedIn channel">
                {channels.map((c) => (
                  <Choice key={c.id} on={c.id === channelId} onClick={() => setChannelId(c.id)}>
                    {c.name}
                  </Choice>
                ))}
              </div>
            )}
            {channels.length === 1 && <p className="m-0 text-[13px] text-muted-foreground">Posting as {channel?.name}</p>}

            <div className="flex flex-col gap-1.5">
              <textarea
                aria-label="Post text"
                value={text}
                rows={9}
                onChange={(e) => setText(e.target.value)}
                className="w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-[13px] leading-relaxed text-strong outline-none placeholder:text-dim focus:border-[#52525b]"
              />
              <div className="flex items-center gap-3 text-xs text-dim">
                <span className="inline-flex min-w-0 grow items-center gap-1.5">
                  <Link2 className="size-3 shrink-0" />
                  <span className="truncate">{url}</span>
                </span>
                <span className={cn("shrink-0", tooLong && "text-overdue")}>
                  {length.toLocaleString()} / {LINKEDIN_LIMIT.toLocaleString()}
                </span>
              </div>
              <p className="m-0 text-xs text-dim">The article link is added at the end automatically.</p>
              {evalNote && (
                <p className="m-0 text-xs text-dim">
                  Dev build: “{evalNote}” is added after the link, so a test post left in Buffer still says what it is.
                </p>
              )}
            </div>

            {ai?.ready ? (
              <div className="flex items-center gap-3">
                {summarizing ? (
                  <Button variant="outline" size="md" onClick={() => summary.current?.cancel()}>
                    <Loader2 className="size-3.5 animate-spin" />
                    Cancel
                  </Button>
                ) : (
                  <Button variant="outline" size="md" onClick={summarize}>
                    <Sparkles className="size-3.5" />
                    Summarise with AI
                  </Button>
                )}
                <span className="text-xs text-dim">
                  {ai.local ? `Runs on this machine with ${ai.label}.` : `Sends this article to ${ai.label}.`} Replaces the text above.
                </span>
              </div>
            ) : (
              <p className="m-0 text-xs text-dim">Connect a model provider in Settings → AI to draft this automatically.</p>
            )}

            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="When to post">
              {TIMINGS.map((t) => (
                <Choice key={t.value} on={t.value === timing} onClick={() => setTiming(t.value)}>
                  {t.label}
                </Choice>
              ))}
              {timing === "schedule" && (
                <Input
                  type="datetime-local"
                  aria-label="Post time"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="h-8 w-auto text-[13px]"
                />
              )}
            </div>
          </>
        )}

        {error && <p className="m-0 text-[13px] text-overdue">{error}</p>}

        {review === null ? (
          <DialogFooter>
            <Button variant="outline" size="md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={!ready} onClick={startReview}>
              Review
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button variant="outline" size="md" disabled={sending} onClick={() => setReview(null)}>
              Back to editing
            </Button>
            <Button size="md" disabled={sending} onClick={send}>
              {sending && <Loader2 className="size-3.5 animate-spin" />}
              {timing === "draft" ? "Save to Buffer" : "Confirm and send"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function whenText(timing: BufferTiming, dueAt: string) {
  if (timing === "schedule") return `Buffer will post this on ${new Date(dueAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`;
  if (timing === "draft") return "This saves a draft in Buffer. Nothing is posted.";
  return "This joins your Buffer queue and posts at your next open slot.";
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-md border border-border px-3 text-[13px] text-muted-foreground hover:text-strong",
        on && "border-border-strong bg-[#18181b] text-strong",
      )}
    >
      {children}
    </button>
  );
}
