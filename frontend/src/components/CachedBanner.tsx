import { History, RefreshCw } from "lucide-react";
import { usePlane } from "@/lib/store";
import { syncedAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Shown over Plane views while they display last session's saved data. */
export function CachedBanner() {
  const { snapshot, readOnly, syncing, syncNow } = usePlane();
  if (!readOnly || !snapshot) return null;
  const failed = !!snapshot.error;
  return (
    <div
      role="status"
      className="drag flex shrink-0 items-center gap-2.5 border-b border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.08)] px-6 py-2 text-xs text-[#fcd34d]"
    >
      <History className="size-3.5 shrink-0" strokeWidth={1.9} />
      <span className="min-w-0 flex-1 truncate">
        Saved data from {syncedAgo(snapshot.syncedAt, Date.now())}.{" "}
        {failed ? `Sync failed: ${snapshot.error}` : "Syncing with Plane…"} Moving, editing and commenting unlock once the sync finishes. Teaching loads
        only from Plane.
      </span>
      {failed && (
        <button
          className="no-drag inline-flex h-7 items-center gap-1.5 rounded-md border border-[rgba(245,158,11,0.35)] px-2.5 hover:bg-[rgba(245,158,11,0.12)]"
          onClick={syncNow}
          disabled={syncing}
        >
          <RefreshCw className={cn("size-3", syncing && "animate-spin")} strokeWidth={2} />
          Retry
        </button>
      )}
    </div>
  );
}
