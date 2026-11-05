import { RefreshCcw } from "lucide-react";
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
