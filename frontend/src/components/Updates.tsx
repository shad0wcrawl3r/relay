import { useEffect, useRef, useState } from "react";
import { Browser, Events } from "@wailsio/runtime";
import { Check, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { UpdateService, type UpdateInfo, type UpdateProgress } from "@/lib/api";
import { ago } from "@/lib/time";
import { errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toaster";

// Release builds on Windows and macOS can update themselves: Go downloads
// the new version, checks its checksum, quits and starts it. Elsewhere (and
// in dev builds) a newer release opens its GitHub page instead.

/** Download progress while an update installs, as "42%" or "12 MB". */
function useProgress(active: boolean) {
  const [p, setP] = useState<UpdateProgress | null>(null);
  useEffect(() => {
    if (!active) return;
    setP(null);
    return Events.On("update:progress", (ev) => setP(ev.data as UpdateProgress));
  }, [active]);
  if (!p) return "";
  return p.total > 0 ? `${Math.floor((p.done / p.total) * 100)}%` : `${(p.done / 1e6).toFixed(0)} MB`;
}

function useInstall() {
  const toast = useToast();
  const [installing, setInstalling] = useState(false);
  const install = async (info: UpdateInfo) => {
    if (installing) return;
    setInstalling(true);
    toast({ tone: "info", title: `Downloading Relay ${info.latest}…`, body: "Relay restarts on the new version when it's ready." }, 20_000);
    try {
      await UpdateService.Install();
      // Relay quits a moment later; the new version opens by itself.
    } catch (err) {
      setInstalling(false);
      toast({
        tone: "error",
        title: "Couldn't install the update",
        body: errorMessage(err),
        actions: [{ label: "Open release page", onClick: () => Browser.OpenURL(info.url) }],
      });
    }
  };
  return { installing, install };
}

/** Mounted once in App: shows the launch check's result. */
export function UpdateNotifier() {
  const toast = useToast();
  const { install } = useInstall();
  const shown = useRef("");
  const installRef = useRef(install);
  installRef.current = install;

  useEffect(() => {
    const show = (info: UpdateInfo) => {
      if (!info.available || shown.current === info.latest) return;
      shown.current = info.latest;
      toast(
        {
          tone: "info",
          keep: true,
          title: `Relay ${info.latest} is available`,
          body: `You have ${info.current}.`,
          actions: info.canInstall
            ? [
                { label: "Update now", primary: true, onClick: () => installRef.current(info) },
                { label: "What's new", onClick: () => Browser.OpenURL(info.url) },
              ]
            : [{ label: "Download", primary: true, onClick: () => Browser.OpenURL(info.url) }],
        },
        30_000,
      );
    };
    // The check may have finished before this mounted.
    UpdateService.Status()
      .then((s) => s.last && show(s.last))
      .catch(() => {});
    return Events.On("update:available", (ev) => show(ev.data as UpdateInfo));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Settings header: a card with the running version, where the last check
 * left it, and one button for the next step (check, update or download).
 */
export function UpdateCheck() {
  const [current, setCurrent] = useState("");
  const [dev, setDev] = useState(false);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<UpdateInfo | null>(null);
  const [checkedAt, setCheckedAt] = useState("");
  const [error, setError] = useState("");
  const { installing, install } = useInstall();
  const progress = useProgress(installing);

  useEffect(() => {
    UpdateService.Status()
      .then((s) => {
        setCurrent(s.display);
        setDev(s.dev);
        if (s.last) {
          setCheckedAt(s.last.checkedAt);
          if (s.last.available) setFound(s.last);
        }
      })
      .catch(() => {});
  }, []);

  const check = async () => {
    setBusy(true);
    setError("");
    try {
      const info = await UpdateService.Check();
      setFound(info.available ? info : null);
      setCheckedAt(info.checkedAt || new Date().toISOString());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const status = installing ? (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Loader2 className="size-3 animate-spin" />
      Downloading {found?.latest}
      {progress && ` · ${progress}`}. Relay restarts when it's ready.
    </span>
  ) : busy ? (
    <span className="text-muted-foreground">Checking GitHub for a newer release…</span>
  ) : error ? (
    <span className="text-overdue">{error}</span>
  ) : found ? (
    <span className="text-[#fbbf24]">Relay {found.latest} is available.</span>
  ) : checkedAt ? (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Check className="size-3 text-[#4ade80]" />
      Up to date · checked {ago(checkedAt) || "just now"}
    </span>
  ) : (
    <span className="text-dim">{dev ? "Development build: a newer release opens its download page." : "Not checked yet this session."}</span>
  );

  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-column-border bg-column px-4 py-3">
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="text-[13px] font-medium text-strong">{current ? `Relay ${current}` : "Relay"}</span>
        <span className="text-xs">{status}</span>
      </div>
      {found && !installing ? (
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => Browser.OpenURL(found.url)}>
            What's new
          </Button>
          {found.canInstall ? (
            <Button size="sm" onClick={() => install(found)}>
              Update now
            </Button>
          ) : (
            <Button size="sm" onClick={() => Browser.OpenURL(found.url)}>
              <ExternalLink className="size-3" /> Download
            </Button>
          )}
        </div>
      ) : (
        <Button variant="outline" size="sm" className="shrink-0" disabled={busy || installing} onClick={check}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          Check for updates
        </Button>
      )}
    </div>
  );
}

/** Settings → Security & privacy: whether to check at launch. */
export function useAutoCheck() {
  const [on, setOn] = useState<boolean | null>(null);
  const toast = useToast();
  useEffect(() => {
    UpdateService.Status()
      .then((s) => setOn(s.autoCheck))
      .catch(() => {});
  }, []);
  const set = async (next: boolean) => {
    try {
      setOn((await UpdateService.SetAutoCheck(next)).autoCheck);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't change the setting", body: errorMessage(err) });
    }
  };
  return [on, set] as const;
}
