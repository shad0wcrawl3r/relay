import { useState } from "react";
import { Browser } from "@wailsio/runtime";
import { ExternalLink, Loader2 } from "lucide-react";
import { SettingsService, type Settings } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Optional Buffer personal API key, only for post metrics: Buffer doesn't
// give them to apps that sign in with OAuth. Everything else stays on OAuth.
export function InsightsKey({ set, onChange }: { set: boolean; onChange: (s: Settings) => void }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      onChange(await SettingsService.SetBufferInsightsKey(key));
      setKey("");
      toast({ tone: "success", title: "Insights key saved", body: "Stored in the system keychain. Relay uses it only to read post metrics." });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't save the key", body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    try {
      onChange(await SettingsService.ClearBufferInsightsKey());
    } catch (err) {
      toast({ tone: "error", title: "Couldn't remove the key", body: errorMessage(err) });
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-column-border bg-column px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] text-strong">Insights key (optional)</span>
        <span className="text-xs text-dim">
          Buffer shares post metrics (impressions, reactions, clicks, LinkedIn included) only with a personal API key, not with apps that sign in with OAuth. Relay uses this
          key for metrics and nothing else, and keeps it in the system keychain.
        </span>
      </div>
      {set ? (
        <div className="flex items-center gap-2">
          <span className="grow text-xs text-muted-foreground">A key is saved.</span>
          <Button variant="outline" size="sm" onClick={clear}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type="password"
            autoComplete="off"
            placeholder="Paste a Buffer API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && key.trim() && void save()}
            className="h-8 grow text-xs"
          />
          <Button size="sm" disabled={!key.trim() || busy} onClick={save}>
            {busy && <Loader2 className="size-3 animate-spin" />}
            Save
          </Button>
        </div>
      )}
      <button className="inline-flex w-fit items-center gap-1 text-xs text-[#93c5fd] hover:underline" onClick={() => Browser.OpenURL("https://developers.buffer.com/guides/authentication.html")}>
        <ExternalLink className="size-3" /> How to get a Buffer API key
      </button>
    </div>
  );
}
