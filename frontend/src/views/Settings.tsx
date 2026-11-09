import { useEffect, useRef, useState } from "react";
import { Browser, CancelError, Clipboard, type CancellablePromise } from "@wailsio/runtime";
import { Check, Compass, Copy, ExternalLink, Loader2 } from "lucide-react";
import { BufferService, GuideService, moduleKey, PlaneService, projectKey, SettingsService, TerminalService, type BufferStatus, type Settings as SettingsT, type SettingsInput } from "@/lib/api";
import { useTerminal } from "@/lib/terminal";
import { showKey } from "@/lib/keys";
import { Switch } from "@/components/ui/switch";
import { usePlane } from "@/lib/store";
import { errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { ShellPicker } from "@/components/ShellPicker";
import { ExportSettingsButton, ImportSettingsButton } from "@/components/SettingsTransfer";
import { DevtoKeyField } from "@/components/DevtoKeyField";
import { ClearDataButton } from "@/components/ClearDataButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Dot } from "@/components/bits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AISettings } from "@/components/AISettings";
import { LogSettings } from "@/components/LogSettings";
import { PlaneAppGuide, planeIntegrationsUrl } from "@/components/PlaneAppGuide";
import { ProjectSettings } from "@/components/ProjectSettings";
import { BufferPlanningRow } from "@/components/BufferPlanningRow";
import { UpdateCheck, useAutoCheck } from "@/components/Updates";
import type { Route } from "@/App";

export type SettingsTab = "plane" | "publishing" | "ai" | "terminal" | "privacy" | "storage" | "logs";

export function Settings({ route }: { route: Extract<Route, { name: "settings" }> }) {
  const toast = useToast();
  const [autoCheck, setAutoCheck] = useAutoCheck();
  const { projects, setLockable, unlockMethod, disconnect: disconnectPlane, snapshot } = usePlane();
  const [s, setS] = useState<SettingsT | null>(null);
  const [form, setForm] = useState<SettingsInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [buffer, setBuffer] = useState<BufferStatus>({ connected: false, account: "" });
  const bufferSignIn = useRef<CancellablePromise<BufferStatus> | null>(null);
  const [bufferConnecting, setBufferConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<string>(route.tab ?? "plane");
  // Links into Settings (Other integrations, Buffer's "Set up") pick a tab,
  // even when Settings is already open. A new route object each click.
  useEffect(() => {
    if (route.tab) setTab(route.tab);
  }, [route]);
  const [planeHelp, setPlaneHelp] = useState(false);
  const [tmuxConf, setTmuxConf] = useState("");
  const { keymap, reloadKeymap } = useTerminal();

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
      terminalTmuxKeys: next.terminalTmuxKeys,
      terminalShell: next.terminalShell,
      autoLockMinutes: next.autoLockMinutes,
    });
  };

  // After a key is saved on its own: take the new saved state, keep the
  // form's unsaved edits.
  const refresh = (next: SettingsT) => setS(next);

  useEffect(() => {
    SettingsService.Get().then(load).catch(() => {});
    TerminalService.TmuxConfig().then(setTmuxConf).catch(() => {});
    BufferService.Status().then(setBuffer).catch(() => {});
  }, []);

  // Follow Plane's state from its snapshots too, so a connection finished
  // behind this view (after a reload mid sign-in) shows without a revisit.
  // Only these fields: reloading the form would drop unsaved edits.
  const planeConnected = snapshot?.connected;
  const planeWorkspace = snapshot?.workspace ?? "";
  useEffect(() => {
    if (planeConnected === undefined) return;
    setS((prev) => (prev && prev.planeConnected !== planeConnected ? { ...prev, planeConnected, connectedSlug: planeWorkspace } : prev));
  }, [planeConnected, planeWorkspace]);

  if (!s || !form) return <main className="flex-1" />;

  const set = (patch: Partial<SettingsInput>) => setForm({ ...form, ...patch });
  const dirty =
    form.planeSecret !== "" ||
    form.planeBaseUrl !== s.planeBaseUrl ||
    form.planeAppUrl !== s.planeAppUrl ||
    form.planeClientId !== s.planeClientId ||
    form.planeWorkspace !== s.planeWorkspace ||
    form.planeRedirectPort !== s.planeRedirectPort ||
    form.planeScope !== s.planeScope ||
    form.syncInterval !== s.syncInterval ||
    form.agentName !== s.agentName ||
    form.agentLabel !== s.agentLabel ||
    form.terminalTmuxKeys !== s.terminalTmuxKeys ||
    form.terminalShell !== s.terminalShell ||
    form.autoLockMinutes !== s.autoLockMinutes;

  const save = async () => {
    setSaving(true);
    try {
      load(await SettingsService.Save(form));
      reloadKeymap();
      toast({ tone: "success", title: "Settings saved", body: "API keys and secrets are in the system keychain." });
      return true;
    } catch (err) {
      toast({ tone: "error", title: "Couldn't save settings", body: errorMessage(err) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const connectBuffer = async () => {
    setBufferConnecting(true);
    const signIn = BufferService.Connect();
    bufferSignIn.current = signIn;
    try {
      setBuffer(await signIn);
      toast({ tone: "success", title: "Connected to Buffer" });
    } catch (err) {
      if (!(err instanceof CancelError)) toast({ tone: "error", title: "Couldn't connect to Buffer", body: errorMessage(err) });
    } finally {
      bufferSignIn.current = null;
      setBufferConnecting(false);
    }
  };

  const disconnectBuffer = async () => {
    try {
      await BufferService.Disconnect();
      setBuffer({ connected: false, account: "" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't disconnect", body: errorMessage(err) });
    }
  };

  const connect = async () => {
    if (dirty && !(await save())) return;
    setConnecting(true);
    try {
      // Go starts the first sync itself.
      await PlaneService.Connect();
      load(await SettingsService.Get());
      toast({ tone: "success", title: "Connected to Plane" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't connect to Plane", body: errorMessage(err) });
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      await disconnectPlane();
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
          <p className="mt-1 text-[13px] text-dim">Settings are saved to {s.configPath}. API keys and secrets go to the system keychain, never that file, and aren't shown again.</p>
          <div className="mt-2 flex gap-4 text-xs">
            {[
              { label: "Source on GitHub", url: "https://github.com/shad0wcrawl3r/relay" },
              { label: "Status", url: "https://relay.shadowcrawler.dev" },
            ].map((l) => (
              <button key={l.url} className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline" onClick={() => Browser.OpenURL(l.url)}>
                <ExternalLink className="size-3" />
                {l.label}
              </button>
            ))}
            <UpdateCheck />
            <button className="ml-auto inline-flex items-center gap-1 text-[#93c5fd] hover:underline" onClick={() => GuideService.Open()}>
              <Compass className="size-3" />
              Run setup guide
            </button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-6">
          <TabsList>
            <TabsTrigger value="plane">Plane</TabsTrigger>
            <TabsTrigger value="publishing">Publishing</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="privacy">Privacy</TabsTrigger>
            <TabsTrigger value="storage">Storage</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="plane">
        <Section
          title="Plane"
          description="Relay connects as a Plane OAuth app that you create in your workspace."
          aside={
            s.planeConnected && (
              <button className="text-xs text-[#93c5fd] hover:underline" aria-expanded={planeHelp} onClick={() => setPlaneHelp((v) => !v)}>
                {planeHelp ? "Hide help" : "Need help?"}
              </button>
            )
          }
        >
          {(!s.planeConnected || planeHelp) && (
            <PlaneAppGuide
              redirectUri={s.redirectUri}
              appUrl={form.planeAppUrl || s.planeAppUrl}
              workspace={s.connectedSlug || form.planeWorkspace}
              defaultOpen
            />
          )}
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
          <Row
            label="Client ID"
            hint={(() => {
              const url = planeIntegrationsUrl(form.planeAppUrl || s.planeAppUrl, s.connectedSlug || form.planeWorkspace);
              const where = "Workspace settings → Integrations";
              return (
                <>
                  Shown on your Plane app under{" "}
                  {url ? (
                    <button className="text-[#93c5fd] hover:underline" onClick={() => Browser.OpenURL(url)}>
                      {where}
                    </button>
                  ) : (
                    where
                  )}{" "}
                  in Plane.
                </>
              );
            })()}
          >
            <Input value={form.planeClientId} onChange={(e) => set({ planeClientId: e.target.value })} autoComplete="off" spellCheck={false} />
          </Row>
          <Row label="Client secret">
            <SecretInput
              
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
                Leave empty to get the scopes ticked on the Plane app (recommended). If you fill this in, every scope must also be
                ticked there, or Plane answers invalid_scope. Relay needs read access to projects, states, labels, modules, cycles,
                members and activity, plus write access to work items and comments.
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

        {(s.planeConnected || snapshot?.bufferPlan) && (
          <Section title="Projects" description="Order and colour in the sidebar, and where quick capture (⌘K) starts. Projects with an Idea state get New idea instead of New item.">
            <ProjectSettings />
          </Section>
        )}

        <Section title="Agent" description="How Relay recognises the agent (Claude Code) on cards and in threads.">
          <Row label="Comment author" hint="Plane display name the agent comments as. Bot accounts are always treated as the agent.">
            <Input value={form.agentName} onChange={(e) => set({ agentName: e.target.value })} />
          </Row>
          <Row label="Agent label" hint="Items with this label get the “agent” tag.">
            <Input value={form.agentLabel} onChange={(e) => set({ agentLabel: e.target.value })} />
          </Row>
        </Section>

          </TabsContent>

          <TabsContent value="publishing">
        <Section title="Dev.to" description="Posts go up as unpublished drafts. Publish from Relay or Dev.to when they're ready.">
          <Row label="API key">
            <DevtoKeyField saved={s.devtoKeySet} onSaved={refresh} onRemove={async () => refresh(await SettingsService.ClearDevtoKey())} />
          </Row>
        </Section>

        <Section title="Buffer" description="Promote published posts on LinkedIn. Nothing is sent until you review it.">
          <div className="flex items-center gap-3 rounded-[10px] border border-column-border bg-column px-4 py-3">
            <Dot color={buffer.connected ? "#46a758" : "#71717a"} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] text-strong">
                {buffer.connected ? (buffer.account ? `Connected as ${buffer.account}` : "Connected") : "Not connected"}
              </span>
              <span className="text-xs text-dim">{buffer.connected ? "Token stored in the system keychain." : "You'll approve access in your browser."}</span>
            </div>
            {bufferConnecting ? (
              <>
                <span className="flex items-center gap-1.5 text-xs text-dim">
                  <Loader2 className="size-3 animate-spin" />
                  Waiting for browser…
                </span>
                <Button variant="outline" onClick={() => bufferSignIn.current?.cancel()}>
                  Cancel
                </Button>
              </>
            ) : buffer.connected ? (
              <Button variant="destructive" onClick={disconnectBuffer}>
                Disconnect
              </Button>
            ) : (
              <Button onClick={connectBuffer}>Connect Buffer</Button>
            )}
          </div>
          {buffer.connected && <BufferPlanningRow />}
        </Section>

          </TabsContent>

          <TabsContent value="ai">
            <AISettings />
          </TabsContent>

          <TabsContent value="privacy">
        <Section
          title="Privacy"
          description="Everything Relay stores on disk is encrypted with a key kept in your system keychain. Locked projects and modules stay hidden until you unlock them."
        >
          <Row
            label="Unlock with"
            hint={
              unlockMethod?.available
                ? "Turning a lock off asks for the same confirmation."
                : "Unlocking needs macOS for now; locked items stay hidden on this system."
            }
          >
            <span className="flex h-9 items-center text-[13px] text-foreground">
              {!unlockMethod ? "…" : !unlockMethod.available ? "Not available" : unlockMethod.biometry ? `${unlockMethod.label.replace("Unlock with ", "")}, or your login password` : "Your login password"}
            </span>
          </Row>
          <Row label="Locked" hint="Projects and their modules (sub-projects). A locked project's modules appear once it's unlocked.">
            <div className="flex flex-col gap-1.5 pt-1.5">
              {projects.length === 0 && <span className="text-xs text-dim">Connect Plane to choose projects.</span>}
              {projects.map((p) => (
                <div key={p.id} className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2.5 text-[13px] text-foreground">
                    <Switch checked={p.private} onCheckedChange={(v) => setLockable(projectKey(p.identifier), v)} />
                    {p.name}
                    <span className="font-mono text-[11px] text-dim">{p.identifier}</span>
                    {p.private && <span className="text-xs text-dim">{p.locked ? "· locked" : "· unlocked"}</span>}
                  </label>
                  {!p.locked &&
                    p.modules.map((m) => (
                      <label key={m.id} className="ml-9 flex items-center gap-2.5 text-xs text-muted-foreground">
                        <Switch checked={m.private} onCheckedChange={(v) => setLockable(moduleKey(m.id), v)} />
                        {m.name}
                        {m.private && <span className="text-dim">{m.locked ? "· locked" : "· unlocked"}</span>}
                      </label>
                    ))}
                </div>
              ))}
            </div>
          </Row>
          <Row label="Lock again after" hint="Minutes after unlocking. Quitting Relay locks everything.">
            <div className="flex items-center gap-2">
              <Input type="number" min={1} value={form.autoLockMinutes} onChange={(e) => set({ autoLockMinutes: Number(e.target.value) })} className="w-24" />
              <span className="text-xs text-dim">minutes</span>
            </div>
          </Row>
          <Row label="Updates" hint="Asks GitHub's public releases list for a newer Relay when it starts. Nothing about you or your data is sent, and nothing is downloaded until you choose to.">
            <label className="flex h-9 items-center gap-2.5 text-[13px] text-foreground">
              <Switch checked={autoCheck ?? false} disabled={autoCheck === null} onCheckedChange={setAutoCheck} />
              Check for updates when Relay starts
            </label>
          </Row>
        </Section>

          </TabsContent>

          <TabsContent value="terminal">
        <Section title="Terminal" description="Sessions run in Relay itself; tmux isn't needed.">
          <Row label="Shell" hint="Used for new sessions. Open ones keep their shell.">
            <ShellPicker value={form.terminalShell} onChange={(terminalShell) => set({ terminalShell })} />
          </Row>
          <Row
            label="tmux keybindings"
            hint={
              tmuxConf ? (
                <>
                  Reads the prefix and bindings from <span className="font-mono">{tmuxConf}</span> on top of tmux's defaults. Splits, pane focus, zoom,
                  windows (as tabs), detach and break-pane are supported; other commands are skipped.
                </>
              ) : (
                "No tmux config found (~/.tmux.conf or ~/.config/tmux/tmux.conf). Relay uses tmux's default keys."
              )
            }
          >
            <label className="flex h-9 items-center gap-2.5 text-[13px] text-foreground">
              <Switch checked={form.terminalTmuxKeys} disabled={!tmuxConf} onCheckedChange={(v) => set({ terminalTmuxKeys: v })} />
              Use my tmux config
            </label>
            {s.terminalTmuxKeys && keymap?.source && (
              <span className="text-xs text-dim">
                Prefix <kbd className="font-mono text-foreground">{showKey(keymap.prefix)}</kbd>
                {keymap.prefix2 && (
                  <>
                    {" "}
                    or <kbd className="font-mono text-foreground">{showKey(keymap.prefix2)}</kbd>
                  </>
                )}{" "}
                · {keymap.bindings.length} bindings
                {keymap.skipped.length > 0 && (
                  <>
                    {" "}
                    · skipped:
                    <span className="mt-1 block whitespace-pre-wrap font-mono">{keymap.skipped.join("\n")}</span>
                  </>
                )}
              </span>
            )}
          </Row>
        </Section>

          </TabsContent>

          <TabsContent value="storage">
        <Section title="Storage">
          <Row label="Posts folder" hint="Each post is a markdown file. Plane data is never stored.">
            <Input readOnly value={s.postsDir} className="font-mono text-xs text-muted-foreground" />
          </Row>
        </Section>
        <Section
          title="Move to another computer"
          description="Export saves your settings and API keys to Downloads, locked with six words. Import them on the other computer. Nothing leaves this one unless you move the file."
        >
          <div className="flex gap-2">
            <ExportSettingsButton onError={(body) => toast({ tone: "error", title: "Couldn't export settings", body })} />
            <ImportSettingsButton
              onError={(body) => toast({ tone: "error", title: "Couldn't import settings", body })}
              onImported={async () => {
                load(await SettingsService.Get());
                reloadKeymap();
              }}
            />
          </div>
        </Section>
        <Section
          title="Clear all data"
          description="Deletes everything Relay stores on this computer: posts, sign-ins and keys, settings and caches. Relay quits afterwards."
        >
          <div>
            <ClearDataButton />
          </div>
        </Section>
          </TabsContent>

          <TabsContent value="logs">
            <LogSettings />
          </TabsContent>
        </Tabs>

        {(dirty || !["ai", "storage", "logs"].includes(tab)) && (
          <div className="sticky bottom-0 -mx-8 flex justify-end gap-2 border-t border-hairline bg-background/95 px-8 py-3 backdrop-blur">
            <Button variant="outline" size="md" disabled={!dirty || saving} onClick={() => load(s)}>
              Discard
            </Button>
            <Button size="md" disabled={!dirty || saving} onClick={save}>
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save settings
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

function Section({ title, description, aside, children }: { title: string; description?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <div className="flex items-baseline gap-3">
          <h2 className="m-0 text-[15px] font-semibold text-strong">{title}</h2>
          {aside}
        </div>
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
