import { useState } from "react";
import { Browser } from "@wailsio/runtime";
import { ExternalLink, Loader2, Megaphone } from "lucide-react";
import { BufferService, type Post, type PromotionPost } from "@/lib/api";
import { ago } from "@/lib/time";
import { errorMessage } from "@/lib/utils";
import { networkName } from "@/components/PostPreview";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BufferFocus } from "@/views/buffer/Buffer";

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

function status(p: PromotionPost): { text: string; tone?: "bad" | "good" } {
  if (p.lookupError) return { text: "Couldn't check Buffer" };
  if (!p.found) return { text: "Deleted from Buffer", tone: "bad" };
  switch (p.status) {
    case "sent":
      return { text: `Posted ${ago(new Date(p.sentAt || p.dueAt))}`, tone: "good" };
    case "draft":
      return { text: "Draft in Buffer" };
    case "needs_approval":
      return { text: "Awaiting approval" };
    case "error":
      return { text: p.error ? `Failed: ${p.error}` : "Failed", tone: "bad" };
    case "sending":
      return { text: "Posting now" };
    default:
      return { text: p.dueAt ? `Scheduled for ${when(p.dueAt)}` : "In the queue" };
  }
}

/** "Promoted once" in the editor's footer: each promotion, with links to its Buffer post. */
export function Promotions({ post, goBuffer }: { post: Post; goBuffer: (focus: BufferFocus) => void }) {
  const [rows, setRows] = useState<PromotionPost[] | null>(null);
  const [error, setError] = useState("");
  const count = post.promotions.length;

  const load = () => {
    setRows(null);
    setError("");
    BufferService.PromotionPosts(post.id).then(setRows, (err) => setError(errorMessage(err)));
  };

  return (
    <Popover onOpenChange={(o) => o && load()}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded px-1 hover:text-strong" title="See the Buffer posts">
          <Megaphone className="size-3.5" strokeWidth={1.9} />
          <span className="underline decoration-dotted underline-offset-[3px]">Promoted {count === 1 ? "once" : `${count} times`}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="flex w-[380px] flex-col gap-1 p-2">
        <p className="m-0 px-2 pb-1 text-xs font-medium text-muted-foreground">Promotions in Buffer</p>
        {error ? (
          <p className="m-0 px-2 py-1.5 text-xs text-overdue">{error}</p>
        ) : rows === null ? (
          <p className="m-0 flex items-center gap-2 px-2 py-1.5 text-xs text-dim">
            <Loader2 className="size-3.5 animate-spin" /> Checking Buffer…
          </p>
        ) : (
          rows.map((r) => {
            const st = status(r);
            return (
              <div key={r.bufferId} className="flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-accent">
                <div className="flex items-center gap-2 text-[13px] text-foreground">
                  <span className="truncate">{r.channel}</span>
                  {r.service && <span className="shrink-0 text-xs text-dim">{networkName(r.service)}</span>}
                  <span className="ml-auto shrink-0 text-[11px] text-dim">sent to Buffer {ago(new Date(r.at))}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className={st.tone === "bad" ? "text-overdue" : st.tone === "good" ? "text-[#4ade80]" : "text-dim"}>{st.text}</span>
                  <span className="ml-auto inline-flex shrink-0 items-center gap-3">
                    {r.found && (
                      <button className="text-dim hover:text-strong" onClick={() => goBuffer({ postId: r.bufferId, status: r.status })}>
                        Show in Buffer tab
                      </button>
                    )}
                    {r.externalLink && (
                      <button className="inline-flex items-center gap-1 text-dim hover:text-strong" onClick={() => Browser.OpenURL(r.externalLink)}>
                        <ExternalLink className="size-3" /> Open on {networkName(r.service) || "the network"}
                      </button>
                    )}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}
