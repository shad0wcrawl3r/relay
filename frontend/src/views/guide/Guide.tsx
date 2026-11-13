import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Browser,
  CancelError,
  Clipboard,
  Events,
  type CancellablePromise,
} from "@wailsio/runtime";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import {
  AIService,
  BufferService,
  GuideService,
  PlaneService,
  SettingsService,
  TerminalService,
  type AIStatus,
  type Shell,
  type BufferStatus,
  type Settings,
} from "@/lib/api";
import { usePlane } from "@/lib/store";
import { useIntegrations } from "@/lib/integrations";
import { cn, errorMessage } from "@/lib/utils";
import { syncedAgo } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { AISettings } from "@/components/AISettings";
import { ShellPicker } from "@/components/ShellPicker";
import { ImportSettingsButton } from "@/components/SettingsTransfer";
import { DevtoKeyField, DevtoKeyLink } from "@/components/DevtoKeyField";
import { BufferLogo } from "@/components/icons/BufferLogo";
import { BufferPlanningRow } from "@/components/BufferPlanningRow";
import {
  planeAppSteps,
  planeIntegrationsUrl,
} from "@/components/PlaneAppGuide";

// The setup guide: a small window that floats above the browser while the
// user creates apps and copies keys there. Each step checks the real state
// (is Buffer connected, is a key saved), so it resumes wherever it was left.

type StepId = "welcome" | "buffer" | "ai" | "devto" | "plane" | "terminal" | "done";
const STEPS: { id: StepId; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "buffer", label: "Buffer" },
  { id: "ai", label: "AI" },
  { id: "devto", label: "Dev.to" },
  { id: "plane", label: "Plane" },
  { id: "terminal", label: "Terminal" },
  { id: "done", label: "Done" },
];

export function Guide() {
  const { snapshot } = usePlane();
  const { buffer, devto } = useIntegrations();
  const planeOn = !!snapshot?.connected;
  const [ai, setAi] = useState<AIStatus | null>(null);
  // The saved shell; "" until one is picked here or in Settings.
  const [shell, setShell] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [error, setError] = useState("");

  const done: Record<StepId, boolean> = {
    welcome: false,
    buffer: buffer === true,
    ai: !!ai?.ready,
    devto: devto === true,
    plane: planeOn,
    terminal: !!shell,
    done: false,
  };

  const refresh = useCallback(() => {
    AIService.Status().then(setAi, () => {});
    TerminalService.Shells().then(
      (c) => setShell(c.chosen),
      () => setShell(""),
    );
  }, []);
  useEffect(refresh, [refresh]);

  // Resume at the first service that isn't set up, once the states are known.
  const known = buffer !== null && devto !== null && !!snapshot && ai !== null && shell !== null;
  useEffect(() => {
    if (step !== null || !known) return;
    const any = done.buffer || done.ai || done.devto || done.plane;
    const next = STEPS.findIndex(
      (st, i) => i > 0 && st.id !== "done" && !done[st.id],
    );
    setStep(!any ? 0 : next === -1 ? STEPS.length - 1 : next);
    // done[] derives from the values in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, known]);

  const onAi = useCallback((s: AIStatus) => setAi(s), []);

  // The terminal step's footer: nothing picked yet, so save the system's
  // default shell (by path, so the step counts as done) and move on.
  const [usingDefault, setUsingDefault] = useState(false);
  const pickDefaultShell = async () => {
    setUsingDefault(true);
    setError("");
    try {
      const c = await TerminalService.Shells();
      const def = c.shells.find((sh) => sh.default)?.path ?? "";
      setShell((await TerminalService.SetShell(def)).chosen);
      setStep((n) => Math.min(STEPS.length - 1, (n ?? 0) + 1));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUsingDefault(false);
    }
  };

  const finish = async (view?: "editor" | "buffer" | "attention") => {
    try {
      if (view) await GuideService.Show(view);
      await GuideService.Finish();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const at = step ?? 0;
  const id = STEPS[at].id;
  const goTo = (i: number) => {
    setError("");
    setStep(Math.min(STEPS.length - 1, Math.max(0, i)));
  };
  const go = (d: number) => goTo(at + d);

  // A step that's now set up has nothing left to warn about, e.g. "already
  // waiting" from a second click before the browser sign-in finished.
  const stepDone = done[id];
  useEffect(() => {
    if (stepDone) setError("");
  }, [stepDone]);

  return (
    <div className="flex h-screen flex-col bg-background text-[13px] text-[#d4d4d8]">
      <div className="drag flex h-9 shrink-0 items-center justify-center text-xs text-dim">
        Set up Relay
      </div>

      <nav className="flex shrink-0 gap-1 px-5 pb-3" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => goTo(i)}
            aria-current={i === at ? "step" : undefined}
            className="no-drag flex min-w-0 flex-1 flex-col gap-1.5 text-left"
          >
            <span
              className={cn(
                "h-1 rounded-full bg-[#27272a]",
                (i < at || done[s.id]) && "bg-[#3f3f46]",
                i === at && "bg-[#93c5fd]",
              )}
            />
            <span
              className={cn(
                "truncate text-[11px] text-dim",
                i === at && "text-strong",
              )}
            >
              {done[s.id] && (
                <Check className="mr-0.5 inline size-3 text-[#46a758]" />
              )}
              {s.label}
            </span>
          </button>
        ))}
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {step === null ? (
          <Loader2 className="mx-auto mt-16 size-4 animate-spin text-dim" />
        ) : id === "welcome" ? (
          <Welcome
            setError={setError}
            onImported={() => {
              // Start over from the first step the import didn't cover.
              setStep(null);
              refresh();
            }}
          />
        ) : id === "buffer" ? (
          <BufferStep connected={done.buffer} setError={setError} />
        ) : id === "ai" ? (
          <Section
            title="Pick a model provider"
            lead="Relay can summarise a post into a LinkedIn draft. It only sends an article when you ask it to."
          >
            <AISettings compact onChange={onAi} />
          </Section>
        ) : id === "devto" ? (
          <DevtoStep saved={done.devto} />
        ) : id === "plane" ? (
          <PlaneStep connected={planeOn} setError={setError} />
        ) : id === "terminal" ? (
          <TerminalStep shell={shell ?? ""} onSaved={setShell} setError={setError} />
        ) : (
          <DoneStep done={done} />
        )}
        {error && <p className="mt-3 text-xs text-overdue">{error}</p>}
      </main>

      <footer className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
        {id === "done" ? (
          <>
            <Button variant="ghost" onClick={() => go(-1)}>
              Back
            </Button>
            <span className="grow" />
            {done.buffer && (
              <Button variant="outline" onClick={() => finish("buffer")}>
                Open Buffer
              </Button>
            )}
            <Button onClick={() => finish("editor")}>Write a post</Button>
          </>
        ) : (
          <>
            {at > 0 ? (
              <Button variant="ghost" onClick={() => go(-1)}>
                Back
              </Button>
            ) : (
              <button
                className="text-xs text-dim hover:text-strong"
                onClick={() => finish()}
              >
                Skip setup
              </button>
            )}
            <span className="grow" />
            {at > 0 && !done[id] && id === "terminal" && (
              <Button variant="ghost" disabled={usingDefault} onClick={pickDefaultShell}>
                {usingDefault && <Loader2 className="size-3.5 animate-spin" />}
                Use Default
              </Button>
            )}
            {at > 0 && !done[id] && id !== "terminal" && (
              <Button variant="ghost" onClick={() => go(1)}>
                Skip
              </Button>
            )}
            {(at === 0 || done[id]) && (
              <Button onClick={() => go(1)}>
                {at === 0 ? "Start" : "Continue"}
              </Button>
            )}
          </>
        )}
      </footer>
    </div>
  );
}

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 text-[17px] font-semibold text-strong">{title}</h1>
        {lead && (
          <p className="mt-1.5 leading-relaxed text-muted-foreground">{lead}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-column-border bg-column px-3 py-2.5">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          ok ? "bg-[#46a758]" : "bg-[#71717a]",
        )}
      />
      <span className="min-w-0 flex-1 text-strong">{children}</span>
    </div>
  );
}

function Welcome({ setError, onImported }: { setError: (e: string) => void; onImported: () => void }) {
  return (
    <Section
      title="Welcome to Relay"
      lead="Write on Dev.to, promote on LinkedIn through Buffer, and keep your Plane board beside it. This guide sets each one up. Every step is optional."
    >
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-muted-foreground">
        <li>• Buffer: write and schedule posts for any of your channels, or promote your articles on LinkedIn.</li>
        <li>
          • AI: draft those posts from the article (optional, local models
          work).
        </li>
        <li>• Dev.to: send drafts and publish from Relay.</li>
        <li>• Plane: your boards and work items (optional).</li>
      </ul>
      <p className="m-0 text-xs leading-relaxed text-dim">
        This window stays on top while you work in the browser, so you can
        follow the steps and copy values from here. Close it any time; it picks
        up where you left off.
      </p>
      <p className="m-0 rounded-[10px] border border-column-border bg-column px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        Moving from another computer?{" "}
        <ImportSettingsButton variant="link" label="Import your settings" onError={setError} onImported={onImported} /> with the six words from
        your export, then sign in to Buffer and Plane.
      </p>
    </Section>
  );
}

// A Buffer sign-in outlives the step's view: moving between steps mustn't
// lose it, or the next click finds Go still waiting.
let bufferSignIn: CancellablePromise<BufferStatus> | null = null;

function BufferStep({
  connected,
  setError,
}: {
  connected: boolean;
  setError: (e: string) => void;
}) {
  const [busy, setBusy] = useState(bufferSignIn !== null);
  const [account, setAccount] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (connected)
      BufferService.Status().then(
        (s) => setAccount(s.account),
        () => {},
      );
  }, [connected]);
  useEffect(
    () => Events.On("buffer:signin", (ev) => setLink(ev.data as string)),
    [],
  );
  // Back on this step while a sign-in is still waiting: follow it.
  useEffect(() => {
    const pending = bufferSignIn;
    if (!pending) return;
    let live = true;
    pending
      .then(
        (s) => live && setAccount(s.account),
        () => {},
      )
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, []);

  const connect = async () => {
    setBusy(true);
    setError("");
    const p = BufferService.Connect();
    bufferSignIn = p;
    try {
      setAccount((await p).account);
    } catch (err) {
      if (!(err instanceof CancelError)) setError(errorMessage(err));
    } finally {
      if (bufferSignIn === p) bufferSignIn = null;
      setBusy(false);
      setLink("");
    }
  };
  const cancel = () => {
    bufferSignIn?.cancel();
    bufferSignIn = null;
    setBusy(false);
    setLink("");
  };

  return (
    <Section
      title="Connect Buffer"
      lead="Relay sends LinkedIn posts through your Buffer account. Nothing is posted until you review it."
    >
      {connected ? (
        <>
          <Status ok>Connected{account && ` as ${account}`}</Status>
          <BufferPlanningRow title="Also use Buffer to plan your work" />
        </>
      ) : (
        <>
          <ol className="m-0 flex flex-col gap-1.5 pl-4 text-muted-foreground">
            <li>Click Connect. Buffer opens in your default browser.</li>
            <li>Sign in and approve Relay.</li>
            <li>Come back here; this step ticks itself off.</li>
          </ol>
          <div className="flex gap-2">
            <Button size="md" onClick={connect} disabled={busy}>
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <BufferLogo className="size-3.5" />
              )}
              {busy ? "Waiting for Buffer…" : "Connect Buffer"}
            </Button>
            {busy && (
              <Button variant="ghost" size="md" onClick={cancel}>
                Cancel
              </Button>
            )}
          </div>
          {busy && (
            <p className="m-0 text-xs leading-relaxed text-dim">
              Wrong browser or profile? Copy the sign-in link and open it where
              you're signed in to Buffer.{" "}
              {link && (
                <button
                  className="text-[#93c5fd] hover:underline"
                  onClick={() => {
                    Clipboard.SetText(link);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "Copied" : "Copy sign-in link"}
                </button>
              )}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function DevtoStep({ saved }: { saved: boolean }) {
  return (
    <Section
      title="Add your Dev.to key"
      lead="Relay sends posts to Dev.to as unpublished drafts. The key is kept in your system keychain."
    >
      {saved && <Status ok>Key saved</Status>}
      <ol className="m-0 flex flex-col gap-1.5 pl-4 text-muted-foreground">
        <li>
          Open <DevtoKeyLink label="Dev.to → Settings → Extensions" />.
        </li>
        <li>
          Under DEV Community API Keys, give it a name (e.g. Relay) and click
          Generate API Key.
        </li>
        <li>Paste the key here. Relay checks it with Dev.to, then saves it.</li>
      </ol>
      <DevtoKeyField saved={saved} onSaved={() => {}} />
    </Section>
  );
}

const PLANE_PARTS = [
  "Workspace",
  "Create the app",
  "Scopes",
  "Credentials",
  "Connect",
];

function PlaneStep({
  connected,
  setError,
}: {
  connected: boolean;
  setError: (e: string) => void;
}) {
  const [s, setS] = useState<Settings | null>(null);
  const [part, setPart] = useState(0);
  const [workspace, setWorkspace] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    SettingsService.Get().then(
      (next) => {
        setS(next);
        setWorkspace(next.connectedSlug || next.planeWorkspace);
        setClientId(next.planeClientId);
        // Credentials already saved: straight to Connect.
        if (next.planeClientId && next.planeSecretSet) setPart(4);
      },
      () => {},
    );
  }, []);

  const steps = useMemo(
    () =>
      s
        ? planeAppSteps(s.redirectUri, s.planeAppUrl, workspace.trim(), true)
        : [],
    [s, workspace],
  );

  if (connected) {
    return (
      <Section title="Connect Plane">
        <Status ok>
          Connected{s?.connectedSlug ? ` to ${s.connectedSlug}` : ""}
        </Status>
        <PlaneSyncStatus />
      </Section>
    );
  }
  if (!s) return null;

  const integrations = planeIntegrationsUrl(s.planeAppUrl, workspace.trim());

  const saveCredentials = async () => {
    setBusy(true);
    setError("");
    try {
      setS(await SettingsService.SavePlaneApp(clientId, secret, workspace));
      setSecret("");
      setPart(4);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      await PlaneService.Connect();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const body = [
    <>
      <p className="m-0 text-muted-foreground">
        Your workspace slug is the part after{" "}
        <code className="font-mono text-xs">
          {s.planeAppUrl.replace(/^https?:\/\//, "")}/
        </code>{" "}
        in Plane's address bar.
      </p>
      <Input
        value={workspace}
        placeholder="my-workspace"
        onChange={(e) => setWorkspace(slugFrom(e.target.value, s.planeAppUrl))}
        spellCheck={false}
        aria-label="Workspace slug"
      />
      <WorkspaceHelp appUrl={s.planeAppUrl} />
      <Button
        variant="outline"
        size="md"
        className="self-start"
        disabled={!integrations}
        onClick={() => Browser.OpenURL(integrations)}
      >
        <ExternalLink className="size-3.5" />
        Open Integrations in Plane
      </Button>
      <p className="m-0 text-xs text-dim">Then click Build your own.</p>
    </>,
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {steps.slice(1, 6).map((st, i) => (
        <li key={i} className="leading-relaxed">
          {st.title}
          {st.body}
        </li>
      ))}
    </ol>,
    <div className="leading-relaxed">
      {steps[6]?.title}
      {steps[6]?.body}
    </div>,
    <>
      <p className="m-0 text-muted-foreground">
        Save the app in Plane. It shows the Client ID and Client Secret; the
        secret only once.
      </p>
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        Client ID
        <Input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        Client secret
        <SecretInput
          value={secret}
          placeholder={s.planeSecretSet ? "Saved. Paste to replace" : ""}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="off"
        />
      </label>
      <Button
        size="md"
        className="self-start"
        onClick={saveCredentials}
        disabled={
          busy || !clientId.trim() || (!secret.trim() && !s.planeSecretSet)
        }
      >
        Save
      </Button>
      <p className="m-0 text-xs text-dim">
        The secret goes to your system keychain.
      </p>
    </>,
    <>
      <p className="m-0 text-muted-foreground">
        Plane opens in your browser. Approve Relay there, then come back.
      </p>
      <Button
        size="md"
        className="self-start"
        onClick={connect}
        disabled={busy || !s.planeClientId}
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {busy ? "Waiting for Plane…" : "Connect Plane"}
      </Button>
      <p className="m-0 text-xs leading-relaxed text-dim">
        If Plane answers <code className="font-mono">unauthorized_client</code>,
        uninstall the app from the workspace, regenerate the secret and try
        again.
      </p>
    </>,
  ][part];

  return (
    <Section
      title="Connect Plane"
      lead="Optional. Relay connects as an OAuth app you create in your Plane workspace; about two minutes."
    >
      <div className="flex items-center justify-between text-xs text-dim">
        <span>
          {part + 1} of {PLANE_PARTS.length} · {PLANE_PARTS[part]}
        </span>
        <span className="flex gap-3">
          {part > 0 && (
            <button
              className="hover:text-strong"
              onClick={() => setPart(part - 1)}
            >
              Previous
            </button>
          )}
          {part < 3 && (
            <button
              className="text-[#93c5fd] hover:underline"
              onClick={() => setPart(part + 1)}
            >
              Next
            </button>
          )}
        </span>
      </div>
      <div className="flex flex-col gap-3 rounded-[10px] border border-column-border bg-column p-4">
        {body}
      </div>
    </Section>
  );
}

// What the first fetch from Plane is doing, live from the snapshot events,
// while the user stays on this step. It never blocks Continue.
function PlaneSyncStatus() {
  const { snapshot, syncing, syncNow } = usePlane();
  const [retrying, setRetrying] = useState(false);
  const [, tick] = useState(0);
  // Keep "synced 12s ago" current.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  if (!snapshot) return null;

  const plane = snapshot.projects.filter((p) => p.source !== "buffer");
  const open = plane.filter((p) => !p.locked);
  const locked = plane.length - open.length;
  const items = open.reduce((n, p) => n + p.items.length, 0);
  const fetching = syncing || snapshot.syncing;
  const synced = snapshot.syncedAt && !snapshot.syncedAt.startsWith("0001") ? syncedAgo(snapshot.syncedAt) : "";
  const retry = async () => {
    setRetrying(true);
    try {
      await syncNow();
    } catch {
      // The snapshot's error says what went wrong.
    } finally {
      setRetrying(false);
    }
  };
  const count = `${open.length} ${open.length === 1 ? "project" : "projects"} and ${items} work ${items === 1 ? "item" : "items"}`;

  return (
    <div className="flex flex-col gap-2 text-xs leading-relaxed">
      {fetching ? (
        <p className="m-0 flex items-start gap-2 text-muted-foreground">
          <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" />
          <span>
            Fetching your projects, states, labels and work items from Plane{plane.length > 0 ? ` (${count} so far)` : ""}. The first sync can take a
            minute on a big workspace; you can continue while it runs.
          </span>
        </p>
      ) : snapshot.error ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-overdue">The last fetch from Plane failed: {snapshot.error}</p>
          <p className="m-0 text-dim">Relay keeps retrying in the background. You can continue and come back to it in Settings → Plane.</p>
          <Button variant="outline" size="sm" className="self-start" disabled={retrying} onClick={retry}>
            {retrying && <Loader2 className="size-3 animate-spin" />}
            Try again now
          </Button>
        </div>
      ) : snapshot.cached ? (
        <p className="m-0 flex items-start gap-2 text-muted-foreground">
          <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" />
          <span>Showing what Relay saved last time ({count}) while it refreshes from Plane. Changes wait until the refresh finishes.</span>
        </p>
      ) : (
        <p className="m-0 flex items-start gap-2 text-muted-foreground">
          <Check className="mt-0.5 size-3 shrink-0 text-[#46a758]" />
          <span>
            Fetched {count}
            {synced ? `, ${synced}` : ""}.
          </span>
        </p>
      )}
      {!fetching && !snapshot.error && !snapshot.cached && plane.length === 0 && (
        <p className="m-0 text-dim">No projects came back. Check that you're a member of a project in this workspace, then try again from Settings → Plane.</p>
      )}
      {locked > 0 && (
        <p className="m-0 text-dim">
          {locked} private {locked === 1 ? "project stays" : "projects stay"} hidden until you unlock {locked === 1 ? "it" : "them"} in the main window.
        </p>
      )}
      <p className="m-0 text-dim">
        Your boards are in the main window's sidebar. Relay syncs with Plane in the background while it runs, and changes you make on a board are written back to
        Plane.
      </p>
    </div>
  );
}

function TerminalStep({
  shell,
  onSaved,
  setError,
}: {
  shell: string;
  onSaved: (path: string) => void;
  setError: (e: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [shells, setShells] = useState<Shell[]>([]);
  useEffect(() => {
    TerminalService.Shells().then(
      (c) => setShells(c.shells),
      () => {},
    );
  }, []);
  const pick = async (path: string) => {
    setBusy(true);
    setError("");
    try {
      // Save the default by its path too, so the step counts as done.
      const target = path || shells.find((s) => s.default)?.path || "";
      onSaved((await TerminalService.SetShell(target)).chosen);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Pick a shell"
      lead="Relay's terminal runs this for new sessions. These are the shells on this computer; change it any time in Settings → Terminal."
    >
      <ShellPicker value={shell} onChange={pick} disabled={busy} />
      {!shell && <p className="m-0 text-xs text-dim">Click one to use it, the default included.</p>}
    </Section>
  );
}

function DoneStep({ done }: { done: Record<StepId, boolean> }) {
  const rows: [StepId, string][] = [
    ["buffer", "Buffer"],
    ["ai", "Model provider"],
    ["devto", "Dev.to"],
    ["plane", "Plane"],
    ["terminal", "Terminal shell"],
  ];
  return (
    <Section
      title="You're set"
      lead="Anything you skipped is in Settings, and Settings → Run setup guide brings this window back."
    >
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map(([id, label]) => (
          <li key={id}>
            <Status ok={done[id]}>
              {label}
              <span className="ml-1.5 text-xs text-dim">
                {done[id] ? "set up" : "skipped"}
              </span>
            </Status>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** A pasted Plane address becomes its workspace slug: the first path part. */
function slugFrom(input: string, appUrl: string): string {
  const host = appUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const t = input.trim();
  const rest = t.replace(/^https?:\/\//, "");
  if (!rest.toLowerCase().startsWith(host.toLowerCase() + "/")) return input;
  return rest.slice(host.length + 1).split(/[/?#]/)[0] ?? "";
}

/** "Don't know your workspace slug?": opens Plane and shows where to look. */
function WorkspaceHelp({ appUrl }: { appUrl: string }) {
  const [open, setOpen] = useState(false);
  const host = appUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!open) {
    return (
      <button className="self-start text-xs text-[#93c5fd] hover:underline" onClick={() => setOpen(true)}>
        Don't know your workspace slug?
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-[#111114] p-3 text-xs leading-relaxed text-muted-foreground">
      <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-4">
        <li>
          Open Plane and sign in. It opens on your workspace.
          <Button variant="outline" size="md" className="mt-1.5 flex" onClick={() => Browser.OpenURL(appUrl)}>
            <ExternalLink className="size-3.5" />
            Open {host}
          </Button>
        </li>
        <li>
          Look at the address bar. The slug is the first part after <code className="font-mono">{host}/</code>:
          <div className="mt-1 rounded bg-background px-2 py-1 font-mono text-[11.5px] text-foreground">
            {host}/<span className="rounded bg-[#2e1a47] px-0.5 text-[#d8b4fe]">acme-team</span>/projects/
          </div>
        </li>
        <li>Type it above, or paste the whole address and Relay keeps just the slug.</li>
      </ol>
      <p className="m-0 text-dim">
        The slug isn't always the workspace's display name: "Acme Team" may be <code className="font-mono">acme-team</code>. In more than one
        workspace? Switch to the one you want from the menu at the top left in Plane first.
      </p>
    </div>
  );
}
