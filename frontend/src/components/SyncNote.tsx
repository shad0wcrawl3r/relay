import { Browser } from "@wailsio/runtime";
import { ExternalLink, Info, RefreshCcw } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";

/** Explains how Buffer ideas and Plane work items sync. */
export function SyncNote({ compact }: { compact?: boolean }) {
  return (
    <Tooltip
      side="bottom"
      label={
        <span className="block max-w-[300px] leading-snug">
          <strong className="font-medium text-strong">Synced with Buffer Ideas.</strong> Ideas made here are created in Buffer, and ideas from Buffer
          show up here. On a Plane board, drag a work item onto the Buffer column to save it as an idea, or drag an idea onto a column to make it a
          work item. Buffer's API can't edit or delete ideas, so do that in Buffer. Private projects never sync.
        </span>
      }
    >
      <span
        tabIndex={0}
        aria-label="Synced with Buffer Ideas"
        className="inline-flex cursor-help items-center gap-1 rounded-full border border-[#1e3a5f] bg-[#0c1726] px-2 py-0.5 text-[11px] text-[#93c5fd] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <RefreshCcw className="size-3" strokeWidth={2} />
        {!compact && "Synced with Buffer"}
      </span>
    </Tooltip>
  );
}

/** Buffer's Create space, where ideas are edited, moved and deleted. */
export const BUFFER_IDEAS_URL = "https://publish.buffer.com/create";

export const openIdeasInBuffer = () => Browser.OpenURL(BUFFER_IDEAS_URL);

/** Says why ideas are changed in Buffer, with a link there. */
export function IdeasInBufferNote({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <button onClick={openIdeasInBuffer} className="inline-flex items-center gap-1 self-start px-1 text-[11px] text-dim hover:text-strong">
        Edit or delete ideas in Buffer <ExternalLink className="size-3" />
      </button>
    );
  }
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-[10px] border border-[#1e3a5f] bg-[#0c1726] px-3.5 py-2.5 text-xs leading-relaxed text-[#bfdbfe]">
      <Info className="mt-0.5 size-3.5 shrink-0 text-[#93c5fd]" />
      <p className="m-0 flex-1">
        <strong className="font-medium text-strong">Edit, move and delete ideas in Buffer.</strong> Buffer's API lets apps like Relay create ideas
        and read them, but not change or remove them, so those happen in Buffer's own app. Changes there show up here at the next reload.
      </p>
      <button onClick={openIdeasInBuffer} className="inline-flex shrink-0 items-center gap-1 text-[#93c5fd] hover:underline">
        Open Buffer <ExternalLink className="size-3" />
      </button>
    </div>
  );
}
