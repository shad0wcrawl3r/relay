import { useEffect, useRef, useState } from "react";
import { Browser, Events } from "@wailsio/runtime";
import { Loader2, RefreshCw } from "lucide-react";
import { UpdateService, type UpdateInfo, type UpdateProgress } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
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

/** Settings header: the running version, a manual check and Update now. */
export function UpdateCheck() {
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<UpdateInfo | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const { installing, install } = useInstall();
  const progress = useProgress(installing);

  useEffect(() => {
    UpdateService.Status()
      .then((s) => {
        setCurrent(s.display);
        if (s.last?.available) setFound(s.last);
      })
      .catch(() => {});
  }, []);

  const check = async () => {
    setBusy(true);
    setMessage(null);
    setFound(null);
    try {
      const info = await UpdateService.Check();
      if (info.available) setFound(info);
      else setMessage({ tone: "ok", text: "You're up to date." });
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2 text-dim">
      {current && <span>Relay {current}</span>}
      {!found && (
        <button className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline disabled:opacity-60" onClick={check} disabled={busy}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          Check for updates
        </button>
      )}
      {message?.tone === "ok" && <span className="text-[#4ade80]">{message.text}</span>}
      {message?.tone === "error" && <span className="text-overdue">{message.text}</span>}
      {found && (
        <>
          <span className="text-[#fbbf24]">Relay {found.latest} is available.</span>
          {installing ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
              Downloading{progress && ` ${progress}`}…
            </span>
          ) : found.canInstall ? (
            <button className="text-[#93c5fd] hover:underline" onClick={() => install(found)}>
              Update now
            </button>
          ) : (
            <button className="text-[#93c5fd] hover:underline" onClick={() => Browser.OpenURL(found.url)}>
              Download
            </button>
          )}
        </>
      )}
    </span>
  );
}

/** Settings → Privacy: whether to check at launch. */
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
