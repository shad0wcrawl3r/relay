import { useEffect, useState } from "react";
import { Browser, Clipboard } from "@wailsio/runtime";
import { Check, Copy, Loader2 } from "lucide-react";
import { PlaneService, SettingsService, type Settings as SettingsT, type SettingsInput } from "@/lib/api";
import { usePlane } from "@/lib/store";
import { errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dot } from "@/components/bits";

export function Settings() {
  const toast = useToast();
  const { syncNow } = usePlane();
  const [s, setS] = useState<SettingsT | null>(null);
  const [form, setForm] = useState<SettingsInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = (next: SettingsT) => {
    setS(next);
    setForm({
      planeBaseUrl: next.planeBaseUrl,
      planeAppUrl: next.planeAppUrl,
      planeClientId: next.planeClientId,
      planeSecret: "",
      planeWorkspace: next.planeWorkspace,
      planeRedirectPort: next.planeRedirectPort,
      planeScope: next.planeScope,
      devtoKey: "",
      syncInterval: next.syncInterval,
      agentName: next.agentName,
      agentLabel: next.agentLabel,
    });
  };

  useEffect(() => {
    SettingsService.Get().then(load).catch(() => {});
  }, []);

  if (!s || !form) return <main className="flex-1" />;

  const set = (patch: Partial<SettingsInput>) => setForm({ ...form, ...patch });
  const dirty =
    form.planeSecret !== "" ||
    form.devtoKey !== "" ||
    form.planeBaseUrl !== s.planeBaseUrl ||
    form.planeAppUrl !== s.planeAppUrl ||
    form.planeClientId !== s.planeClientId ||
    form.planeWorkspace !== s.planeWorkspace ||
    form.planeRedirectPort !== s.planeRedirectPort ||
    form.planeScope !== s.planeScope ||
    form.syncInterval !== s.syncInterval ||
    form.agentName !== s.agentName ||
    form.agentLabel !== s.agentLabel;

  const save = async () => {
    setSaving(true);
    try {
      load(await SettingsService.Save(form));
      toast({ tone: "success", title: "Settings saved", body: s.configPath });
      return true;
    } catch (err) {
      toast({ tone: "error", title: "Couldn't save settings", body: errorMessage(err) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const connect = async () => {
    if (dirty && !(await save())) return;
    setConnecting(true);
    try {
      await PlaneService.Connect();
      load(await SettingsService.Get());
      toast({ tone: "success", title: "Connected to Plane" });
      syncNow();
    } catch (err) {
      toast({ tone: "error", title: "Couldn't connect to Plane", body: errorMessage(err) });
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      await PlaneService.Disconnect();
      load(await SettingsService.Get());
    } catch (err) {
      toast({ tone: "error", title: "Couldn't disconnect", body: errorMessage(err) });
    }
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className="drag h-10" />
      <div className="mx-auto flex max-w-[720px] flex-col gap-8 px-8 pb-16">
        <div>
          <h1 className="m-0 text-[22px] font-semibold tracking-[-.01em] text-strong">Settings</h1>
          <p className="mt-1 text-[13px] text-dim">Saved to {s.configPath}. Secrets are never shown again once saved.</p>
        </div>

        <Section title="Plane" description="Relay connects as a Plane OAuth app. Create one in your workspace settings with the redirect URI below.">
          <div className="flex items-center gap-3 rounded-[10px] border border-column-border bg-column px-4 py-3">
            <Dot color={s.planeConnected ? "#46a758" : "#71717a"} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] text-strong">{s.planeConnected ? `Connected to ${s.connectedSlug}` : "Not connected"}</span>
              <span className="text-xs text-dim">{s.planeConnected ? "Token stored in the system keychain." : "You'll approve access in your browser."}</span>
            </div>
            {s.planeConnected ? (
              <>
                <Button variant="outline" onClick={connect} disabled={connecting}>
                  Reconnect
                </Button>
                <Button variant="destructive" onClick={disconnect}>
                  Disconnect
                </Button>
              </>
            ) : (
              <Button onClick={connect} disabled={connecting || !form.planeClientId || (!s.planeSecretSet && !form.planeSecret)}>
                {connecting && <Loader2 className="size-3 animate-spin" />}
                {connecting ? "Waiting for browser…" : "Connect Plane"}
              </Button>
            )}
          </div>
          <Row label="Redirect URI" hint="Register this exact URI on the OAuth app.">
            <div className="flex gap-2">
              <Input readOnly value={s.redirectUri} className="font-mono text-xs text-muted-foreground" />
              <Button
                variant="outline"
                size="icon"
                className="size-9 shrink-0"
                aria-label="Copy redirect URI"
                onClick={() => {
                  Clipboard.SetText(s.redirectUri);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
          </Row>
          <Row label="Client ID">
            <Input value={form.planeClientId} onChange={(e) => set({ planeClientId: e.target.value })} autoComplete="off" spellCheck={false} />
          </Row>
          <Row label="Client secret">
            <Input
              type="password"
              value={form.planeSecret}
              placeholder={s.planeSecretSet ? "•••••••• (saved — type to replace)" : ""}
              onChange={(e) => set({ planeSecret: e.target.value })}
              autoComplete="off"
            />
          </Row>
          <Row label="API base URL" hint="Change this when you move to self-hosted Plane.">
            <Input value={form.planeBaseUrl} onChange={(e) => set({ planeBaseUrl: e.target.value })} spellCheck={false} />
          </Row>
          <Row label="Web app URL" hint="Used by “Open in Plane”.">
            <Input value={form.planeAppUrl} onChange={(e) => set({ planeAppUrl: e.target.value })} spellCheck={false} />
          </Row>
          <Row label="Workspace slug" hint="Normally detected on connect; set it if detection fails.">
            <Input value={form.planeWorkspace} placeholder={s.connectedSlug || "my-workspace"} onChange={(e) => set({ planeWorkspace: e.target.value })} spellCheck={false} />
          </Row>
          <Row
            label="Scopes"
            hint={
              <>
                Space-separated. Tick the same scopes on the Plane app.{" "}
                {form.planeScope !== s.defaultScope && (
                  <button className="text-[#93c5fd] hover:underline" onClick={() => set({ planeScope: s.defaultScope })}>
                    Reset to Relay's defaults
                  </button>
                )}
              </>
            }
          >
            <textarea
              value={form.planeScope}
              rows={3}
              spellCheck={false}
              onChange={(e) => set({ planeScope: e.target.value })}
              className="w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs leading-relaxed text-strong outline-none focus:border-[#52525b]"
            />
          </Row>
          <Row label="Redirect port">
            <Input type="number" min={1024} max={65535} value={form.planeRedirectPort} onChange={(e) => set({ planeRedirectPort: Number(e.target.value) })} className="w-32" />
          </Row>
          <Row label="Sync every" hint="Seconds between Plane syncs (minimum 30). Plane rate-limits API calls.">
            <Input type="number" min={30} value={form.syncInterval} onChange={(e) => set({ syncInterval: Number(e.target.value) })} className="w-32" />
          </Row>
        </Section>

        <Section title="Agent" description="How Relay recognises the agent (Claude Code) on cards and in threads.">
          <Row label="Comment author" hint="Plane display name the agent comments as. Bot accounts are always treated as the agent.">
            <Input value={form.agentName} onChange={(e) => set({ agentName: e.target.value })} />
          </Row>
          <Row label="Agent label" hint="Items with this label get the “agent” tag.">
            <Input value={form.agentLabel} onChange={(e) => set({ agentLabel: e.target.value })} />
          </Row>
        </Section>

        <Section title="Dev.to" description="Drafts are sent unpublished; you add images and publish on Dev.to.">
          <Row
            label="API key"
            hint={
              <>
                Create one under{" "}
                <button className="text-[#93c5fd] hover:underline" onClick={() => Browser.OpenURL("https://dev.to/settings/extensions")}>
                  Settings → Extensions
                </button>{" "}
                on Dev.to.
              </>
            }
          >
            <div className="flex gap-2">
              <Input
                type="password"
                value={form.devtoKey}
                placeholder={s.devtoKeySet ? "•••••••• (saved — type to replace)" : ""}
                onChange={(e) => set({ devtoKey: e.target.value })}
                autoComplete="off"
              />
              {s.devtoKeySet && (
                <Button variant="outline" size="md" onClick={async () => load(await SettingsService.ClearDevtoKey())}>
                  Remove
                </Button>
              )}
            </div>
          </Row>
        </Section>

        <Section title="Storage">
          <Row label="Posts folder" hint="Each post is a markdown file. Plane data is never stored.">
            <Input readOnly value={s.postsDir} className="font-mono text-xs text-muted-foreground" />
          </Row>
        </Section>

        <div className="sticky bottom-0 -mx-8 flex justify-end gap-2 border-t border-hairline bg-background/95 px-8 py-3 backdrop-blur">
          <Button variant="outline" size="md" disabled={!dirty || saving} onClick={() => load(s)}>
            Discard
          </Button>
          <Button size="md" disabled={!dirty || saving} onClick={save}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Save settings
          </Button>
        </div>
      </div>
    </main>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="m-0 text-[15px] font-semibold text-strong">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-dim">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_minmax(0,1fr)] items-start gap-4">
      <span className="pt-2.5 text-[13px] text-muted-foreground">{label}</span>
      <div className="flex flex-col gap-1.5">
        {children}
        {hint && <span className="text-xs text-dim">{hint}</span>}
      </div>
    </div>
  );
}
