import { useState } from "react";
import { Browser } from "@wailsio/runtime";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { SettingsService, type Settings } from "@/lib/api";
import { cn, errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SecretInput } from "@/components/ui/secret-input";

// The Dev.to API key, entered and saved on its own: Relay checks it with
// Dev.to first and only saves a key that works. Used in Settings and the
// setup guide.

export const DEVTO_KEYS_URL = "https://dev.to/settings/extensions";

/** True for Go's devto.ErrBadKey: Dev.to refused the key (401 or 403). */
export const isBadDevtoKey = (message: string) => message.includes("Dev.to didn't accept");

/** "Get a new key" link to Dev.to's key page, for next to a key error. */
export function DevtoKeyLink({ label = "Get a key on Dev.to", className }: { label?: string; className?: string }) {
  return (
    <button className={cn("inline-flex items-center gap-1 text-[#93c5fd] hover:underline", className)} onClick={() => Browser.OpenURL(DEVTO_KEYS_URL)}>
      {label}
      <ExternalLink className="size-3" />
    </button>
  );
}

interface Props {
  saved: boolean;
  onSaved: (s: Settings) => void;
  /** Removing is offered in Settings, not the guide. */
  onRemove?: () => void;
}

export function DevtoKeyField({ saved, onSaved, onRemove }: Props) {
  const [key, setKey] = useState("");
  const [phase, setPhase] = useState<"idle" | "checking" | "saving">("idle");
  const [error, setError] = useState("");
  const [user, setUser] = useState("");

  const run = async () => {
    setError("");
    setUser("");
    try {
      setPhase("checking");
      const who = await SettingsService.CheckDevtoKey(key);
      setPhase("saving");
      onSaved(await SettingsService.SaveDevtoKey(key));
      setUser(who.username);
      setKey("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPhase("idle");
    }
  };
  const busy = phase !== "idle";

  return (
    <div className="flex flex-col gap-1.5">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim() && !busy) run();
        }}
      >
        <SecretInput
          value={key}
          aria-label="Dev.to API key"
          placeholder={saved ? "Saved. Paste a new key to replace it" : "Paste your API key"}
          onChange={(e) => {
            setKey(e.target.value);
            setError("");
          }}
          autoComplete="off"
          aria-invalid={!!error}
        />
        <Button type="submit" size="md" disabled={busy || !key.trim()} className="shrink-0">
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {phase === "checking" ? "Checking…" : phase === "saving" ? "Saving…" : "Check and save"}
        </Button>
        {saved && onRemove && (
          <Button type="button" variant="outline" size="md" onClick={onRemove} disabled={busy}>
            Remove
          </Button>
        )}
      </form>
      {error ? (
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-overdue">
          {error.replace(/\.?$/, ".")}
          {isBadDevtoKey(error) && <DevtoKeyLink label="Get a new key" />}
        </span>
      ) : user ? (
        <span className="flex items-center gap-1 text-xs text-[#4ade80]">
          <Check className="size-3" />
          Works: signed in as @{user}. Saved to the system keychain.
        </span>
      ) : (
        <span className="text-xs text-dim">
          {saved ? "Saved in the system keychain." : "Relay checks the key with Dev.to before saving it."} <DevtoKeyLink label="Get a key" />
        </span>
      )}
    </div>
  );
}
