import { useEffect, useMemo, useRef, useState } from "react";
import { CancelError, type CancellablePromise } from "@wailsio/runtime";
import { Loader2, Sparkles } from "lucide-react";
import { AIService, BufferService, type AIStatus, type BufferChannel, type BufferTiming } from "@/lib/api";
import { LIMITS, PostPreview, PREVIEW_NOTE } from "@/components/PostPreview";
import { cn, errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { preloadOnIntent, WarmupNote } from "@/components/ModelWarmup";

// Networks that won't take a text-only post. Relay can't attach media yet.
const NEEDS_MEDIA = new Set(["instagram", "tiktok", "youtube", "pinterest"]);

const TIMINGS: { value: BufferTiming; label: string }[] = [
  { value: "queue", label: "Add to queue" },
  { value: "schedule", label: "Pick a time" },
  { value: "draft", label: "Save as draft" },
];

/** Tomorrow at 9am, in the format a datetime-local input expects. */
function defaultTime() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const label = (c: BufferChannel) => c.displayName || c.name;

/** Why Relay can't post to a channel, or "" when it can. */
export function unusable(c: BufferChannel): string {
  if (c.isDisconnected) return "Reconnect it in Buffer";
  if (c.isLocked) return "Locked on your Buffer plan";
  if (NEEDS_MEDIA.has(c.service)) return "Needs an image or video";
  return "";
}

/** The strictest text limit among the channels Relay can post to, or 3000. */
export function strictestLimit(channels: BufferChannel[]): number {
  const limits = channels.filter((c) => !unusable(c)).map((c) => LIMITS[c.service]).filter((n): n is number => !!n);
  return limits.length ? Math.min(...limits) : 3000;
}

/** Writes a Buffer post that isn't about an article, for one or more channels. */
export function ComposeDialog({
  channels,
  initialText = "",
  onClose,
  onSent,
}: {
  channels: BufferChannel[];
  initialText?: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const toast = useToast();
  const usable = useMemo(() => channels.filter((c) => !unusable(c)), [channels]);
  const [picked, setPicked] = useState<string[]>(() => (usable.length === 1 ? [usable[0].id] : []));
  const [text, setText] = useState(initialText);
  const [timing, setTiming] = useState<BufferTiming>("queue");
  const [dueAt, setDueAt] = useState(defaultTime);
  const [evalNote, setEvalNote] = useState("");
  const [review, setReview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [ai, setAi] = useState<AIStatus | null>(null);
  const [drafting, setDrafting] = useState(false);
  const draft = useRef<CancellablePromise<string> | null>(null);

  useEffect(() => {
    BufferService.EvalNote().then(setEvalNote, () => {});
    AIService.Status().then(setAi, () => {});
    return () => {
      draft.current?.cancel();
    };
  }, []);

  const chosen = channels.filter((c) => picked.includes(c.id));
  const length = text.trim().length + (evalNote && !text.includes(evalNote) ? evalNote.length + 2 : 0);
  // The strictest limit among the chosen channels decides.
  const limit = chosen.reduce<{ n: number; who: string } | null>((min, c) => {
    const n = LIMITS[c.service];
    return n && (!min || n < min.n) ? { n, who: label(c) } : min;
  }, null);
  const tooLong = !!limit && length > limit.n;
  const ready = chosen.length > 0 && text.trim() !== "" && !tooLong && !drafting && (timing !== "schedule" || dueAt);

  // Room for the dev-build note, so the draft still fits once it's added.
  const draftWithAI = async () => {
    setDrafting(true);
    setError("");
    const request = AIService.DraftPost(text, (limit?.n ?? 3000) - (evalNote ? evalNote.length + 2 : 0));
    draft.current = request;
    try {
      setText(await request);
    } catch (err) {
      if (!(err instanceof CancelError)) setError(errorMessage(err));
    } finally {
      draft.current = null;
      setDrafting(false);
    }
  };

  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const startReview = async () => {
    setError("");
    try {
      setReview(await BufferService.ComposedText(text));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const send = async () => {
    setSending(true);
    setError("");
    try {
      const results = await BufferService.Compose({
        channelIds: picked,
        text,
        timing,
        dueAt: timing === "schedule" ? new Date(dueAt).toISOString() : "",
      });
      const failed = results.filter((r) => r.error);
      const ok = results.length - failed.length;
      if (ok > 0) {
        const verb = timing === "draft" ? "Saved as a Buffer draft" : timing === "schedule" ? "Scheduled in Buffer" : "Added to your Buffer queue";
        toast({ tone: "success", title: verb, body: chosen.filter((c) => !failed.some((f) => f.channelId === c.id)).map(label).join(", ") });
        onSent?.();
      }
      if (failed.length === 0) {
        onClose();
        return;
      }
      // Keep the dialog open on the channels that didn't take it.
      const name = (id: string) => label(channels.find((c) => c.id === id) ?? ({ name: id } as BufferChannel));
      setPicked(failed.map((f) => f.channelId));
      setReview(null);
      setError(failed.map((f) => `${name(f.channelId)}: ${f.error}`).join("\n"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent className="flex max-w-[560px] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{review === null ? "New post" : "Review your post"}</DialogTitle>
          <DialogDescription>
            {review === null ? "Write a post for Buffer. It doesn't need an article." : whenText(timing, dueAt, chosen.map(label))}
          </DialogDescription>
        </DialogHeader>

        {review !== null ? (
          <div className="flex flex-col gap-2">
            <div className="flex max-h-[56vh] flex-col gap-3 overflow-y-auto">
              {chosen.map((c) => (
                <PostPreview key={c.id} channel={c} text={review} />
              ))}
            </div>
            <p className="m-0 text-xs text-dim">{PREVIEW_NOTE}</p>
          </div>
        ) : channels.length === 0 ? (
          <p className="m-0 text-[13px] text-muted-foreground">No channels in this organization. Connect one in Buffer, then refresh.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Channels">
              {channels.map((c) => {
                const why = unusable(c);
                return (
                  <button
                    key={c.id}
                    aria-pressed={picked.includes(c.id)}
                    disabled={!!why}
                    title={why || undefined}
                    onClick={() => toggle(c.id)}
                    className={cn(
                      "inline-flex h-8 items-center gap-2 rounded-md border border-border px-2.5 text-[13px] text-muted-foreground hover:text-strong disabled:cursor-not-allowed disabled:opacity-40",
                      picked.includes(c.id) && "border-border-strong bg-[#18181b] text-strong",
                    )}
                  >
                    {c.avatar ? <img src={c.avatar} alt="" className="size-5 rounded-full object-cover" /> : null}
                    {label(c)}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-1.5">
              <textarea
                aria-label="Post text"
                value={text}
                rows={9}
                autoFocus
                placeholder="What do you want to say? Write the post, or rough notes for AI to draft from."
                onChange={(e) => setText(e.target.value)}
                className="w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-[13px] leading-relaxed text-strong outline-none placeholder:text-dim focus:border-[#52525b]"
              />
              <div className="flex items-center justify-end gap-3 text-xs text-dim">
                {limit && (
                  <span className={cn(tooLong && "text-overdue")} title={`${limit.who} allows ${limit.n.toLocaleString()}`}>
                    {length.toLocaleString()} / {limit.n.toLocaleString()}
                  </span>
                )}
              </div>
              {evalNote && (
                <p className="m-0 text-xs text-dim">Dev build: “{evalNote}” is added at the end, so a test post left in Buffer still says what it is.</p>
              )}
            </div>

            {ai?.ready ? (
              <div className="flex items-center gap-3">
                {drafting ? (
                  <Button variant="outline" size="md" onClick={() => draft.current?.cancel()}>
                    <Loader2 className="size-3.5 animate-spin" />
                    Cancel
                  </Button>
                ) : (
                  <Button variant="outline" size="md" disabled={!text.trim()} onClick={draftWithAI} {...preloadOnIntent}>
                    <Sparkles className="size-3.5" />
                    Draft with AI
                  </Button>
                )}
                <span className="text-xs text-dim">
                  Rewrites your notes{limit ? ` to fit ${limit.who}` : ""}.{" "}
                  {ai.local ? `Runs on this machine with ${ai.label}.` : `Sends them to ${ai.label}.`}
                </span>
                <WarmupNote />
              </div>
            ) : (
              <p className="m-0 text-xs text-dim">Connect a model provider in Settings → AI to draft posts from your notes.</p>
            )}

            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="When to post">
              {TIMINGS.map((t) => (
                <button
                  key={t.value}
                  role="radio"
                  aria-checked={t.value === timing}
                  onClick={() => setTiming(t.value)}
                  className={cn(
                    "inline-flex h-8 items-center rounded-md border border-border px-3 text-[13px] text-muted-foreground hover:text-strong",
                    t.value === timing && "border-border-strong bg-[#18181b] text-strong",
                  )}
                >
                  {t.label}
                </button>
              ))}
              {timing === "schedule" && (
                <Input type="datetime-local" aria-label="Post time" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="h-8 w-auto text-[13px]" />
              )}
            </div>
          </>
        )}

        {error && <p className="m-0 whitespace-pre-wrap text-[13px] text-overdue">{error}</p>}

        {review === null ? (
          <DialogFooter>
            <Button variant="outline" size="md" onClick={onClose}>
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

function whenText(timing: BufferTiming, dueAt: string, names: string[]) {
  const to = names.join(", ");
  if (timing === "schedule") return `Buffer will post this to ${to} on ${new Date(dueAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`;
  if (timing === "draft") return `This saves a draft for ${to} in Buffer. Nothing is posted.`;
  return `This joins the queue for ${to} and posts at the next open slot.`;
}
