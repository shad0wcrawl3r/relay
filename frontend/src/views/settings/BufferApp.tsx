import { useEffect, useState } from "react";
import { Browser } from "@wailsio/runtime";
import { ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { BufferService, type BufferApp as App } from "@/lib/api";
import { cn, errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { CopyValue } from "@/components/PlaneAppGuide";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";

/**
 * Settings → Publishing → Buffer → OAuth app: sign in with Relay's Buffer app (the
 * default) or one you create, like the Plane app. Useful when Relay's app is
 * rate limited. Switching apps signs out, because a sign-in only refreshes
 * with the app it was made with.
 */
export function BufferAppRow({ onSignedOut, label = "OAuth app" }: { onSignedOut: () => void; label?: string }) {
  const toast = useToast();
  const [app, setApp] = useState<App | null>(null);
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    BufferService.App().then(
      (a) => {
        setApp(a);
        setClientId(a.clientId);
        setOpen(a.custom);
      },
      () => {},
    );
  }, []);
  if (!app) return null;

  const save = async (id: string, sec: string) => {
    setBusy(true);
    const wasSignedIn = app.signedInWith !== "";
    try {
      const next = await BufferService.SetApp(id, sec);
      setApp(next);
      setClientId(next.clientId);
      setSecret("");
      if (wasSignedIn && next.signedInWith === "") onSignedOut();
      toast({
        tone: "success",
        title: next.custom ? "Using your Buffer app" : "Using Relay's Buffer app",
        body: wasSignedIn && next.signedInWith === "" ? "Signed out of Buffer. Connect again to sign in with this app." : undefined,
      });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't save the Buffer app", body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const dirty = clientId.trim() !== app.clientId || secret.trim() !== "";
  // Signed in with a different app than the one being saved: saving signs out.
  const signedInId = app.signedInWith === "custom" ? app.clientId : "";
  const switching = app.signedInWith !== "" && clientId.trim() !== signedInId;

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-column-border bg-column px-4 py-3">
      <button aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-w-0 items-center gap-2 text-left">
        <ChevronRight className={cn("size-3.5 shrink-0 text-dim transition-transform", open && "rotate-90")} />
        <span className="shrink-0 text-[13px] text-strong">{label}</span>
        <span className="min-w-0 truncate text-xs text-dim" title={app.custom ? app.clientId : undefined}>
          {app.custom ? `Your own (${app.clientId})` : "Relay's"}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 pl-5">
          <p className="m-0 text-xs leading-relaxed text-dim">
            Relay signs in to Buffer with its own app. If that app is rate limited, or you'd rather use yours, create an app in Buffer and paste its client ID here.
            Switching apps signs you out of Buffer; connect again afterwards.
          </p>
          <ol className="m-0 flex list-decimal flex-col gap-2 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>
              Create an OAuth app in Buffer.{" "}
              <button className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline" onClick={() => Browser.OpenURL("https://developers.buffer.com/guides/authentication.html")}>
                <ExternalLink className="size-3" /> Buffer's guide
              </button>
            </li>
            <li>
              Set its redirect URI to exactly:
              <CopyValue value={app.redirectUri} label="redirect URI" />
            </li>
            <li>
              Allow these scopes: <code className="font-mono text-[11px] text-[#e4e4e7]">{(app.scopes ?? []).join(" ")}</code>
            </li>
            <li>Paste the client ID below. Add the client secret only if Buffer gave you one; Relay signs in with PKCE either way.</li>
          </ol>
          <div className="flex flex-col gap-2">
            <Input value={clientId} placeholder="Client ID" spellCheck={false} aria-label="Buffer client ID" onChange={(e) => setClientId(e.target.value)} className="h-8 text-xs" />
            <SecretInput
              value={secret}
              placeholder={app.secretSet ? "Client secret saved (leave blank to keep it)" : "Client secret (optional)"}
              aria-label="Buffer client secret"
              onChange={(e) => setSecret(e.target.value)}
              className="h-8 text-xs"
            />
            <span className="text-xs text-dim">The client ID is saved in Relay's settings file; the secret goes in the system keychain.</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy || !dirty || !clientId.trim()} onClick={() => save(clientId, secret)}>
              {busy && <Loader2 className="size-3 animate-spin" />}
              {switching ? "Save and sign out" : "Save"}
            </Button>
            {app.custom && (
              <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={() => save("", "")}>
                {app.signedInWith === "custom" ? "Use Relay's app and sign out" : "Use Relay's app"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
