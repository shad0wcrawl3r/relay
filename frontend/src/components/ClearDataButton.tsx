import { useState } from "react";
import { Loader2 } from "lucide-react";
import { SettingsService } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CONFIRM_WORD = "delete";

/** Settings → Storage: deletes everything Relay stores, then quits. */
export function ClearDataButton() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    setTyped("");
    setError("");
  };

  const clear = async () => {
    setBusy(true);
    setError("");
    try {
      await SettingsService.ClearAllData();
    } catch (err) {
      // Relay still quits; this says what was left behind.
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="destructive" size="md" onClick={() => toggle(true)}>
        Clear all data…
      </Button>
      <Dialog open={open} onOpenChange={toggle}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all of Relay's data?</DialogTitle>
            <DialogDescription>This can't be undone. Relay quits when it's done, and the next launch starts from the setup guide.</DialogDescription>
          </DialogHeader>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-relaxed text-muted-foreground">
            <li>Posts in Relay's posts folder. Anything already on Dev.to stays there.</li>
            <li>Sign-ins to Plane and Buffer, the Dev.to key and AI provider keys, from the system keychain.</li>
            <li>Settings, the encrypted Plane cache, terminal layout and the encryption key.</li>
            <li>The app window's own storage.</li>
          </ul>
          <p className="m-0 text-[13px] text-muted-foreground">
            Your Plane, Dev.to and Buffer accounts aren't touched, and nor are settings exports in Downloads. Terminal sessions end.
          </p>
          <label className="flex flex-col gap-1.5 text-[13px] text-foreground">
            Type “{CONFIRM_WORD}” to confirm
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} aria-label="Confirmation" disabled={busy} />
          </label>
          {error && <p className="m-0 text-xs text-overdue">Some data couldn't be deleted: {error}</p>}
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={() => toggle(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" size="md" disabled={busy || typed.trim().toLowerCase() !== CONFIRM_WORD} onClick={clear}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Delete everything and quit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
