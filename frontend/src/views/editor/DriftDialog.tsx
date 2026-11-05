import { useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import type { Drift } from "@/lib/api";
import { ago } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DiffView } from "@/components/diff/DiffView";

interface Props {
  drift: Drift | null;
  onOpenChange: (open: boolean) => void;
  /** Replace Relay's copy with Dev.to's. */
  onPull: () => Promise<void>;
  /** Send Relay's copy over Dev.to's edits. */
  onOverwrite: () => Promise<void>;
}

/** Shows how Dev.to's copy differs from Relay's, and lets the user pick one. */
export function DriftDialog({ drift, onOpenChange, onPull, onOverwrite }: Props) {
  const [busy, setBusy] = useState<"pull" | "overwrite" | null>(null);
  const run = async (which: "pull" | "overwrite") => {
    setBusy(which);
    try {
      await (which === "pull" ? onPull() : onOverwrite());
    } finally {
      setBusy(null);
    }
  };
  const edited = drift?.editedAt && !drift.editedAt.startsWith("0001") ? ` ${ago(drift.editedAt)}` : "";

  return (
    <Dialog open={!!drift} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex h-[min(88vh,900px)] max-w-[1180px] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{drift?.known ? "Edited on Dev.to" : "Dev.to's copy is different"}</DialogTitle>
          <DialogDescription>
            {drift?.known
              ? `This post was changed on Dev.to${edited} since Relay last sent it. Updating now would replace those changes.`
              : "Relay can't tell which side changed: this post was sent before Relay kept track. Check the differences before updating."}
          </DialogDescription>
        </DialogHeader>

        {drift && drift.remoteTitle !== drift.localTitle && (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[10px] border border-column-border bg-[#0c0c0e] px-3 py-2 text-[13px]">
            <span className="text-dim">Title on Dev.to</span>
            <span className="truncate text-[#fca5a5]">{drift.remoteTitle}</span>
            <span className="text-dim">Title in Relay</span>
            <span className="truncate text-[#86efac]">{drift.localTitle}</span>
          </div>
        )}

        {drift && <DiffView className="flex-1" oldText={drift.remoteBody} newText={drift.localBody} oldLabel="Dev.to" newLabel="Relay (what Update sends)" />}

        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-dim">Green is what Relay would add, red what it would remove from Dev.to.</span>
          <Button variant="ghost" size="md" disabled={!!busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" size="md" disabled={!!busy} onClick={() => run("pull")}>
            {busy === "pull" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            Use Dev.to's version
          </Button>
          <Button variant="destructive" size="md" disabled={!!busy} onClick={() => run("overwrite")}>
            {busy === "overwrite" ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Replace with Relay's
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
