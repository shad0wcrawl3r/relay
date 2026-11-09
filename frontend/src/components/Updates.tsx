import { useEffect, useRef, useState } from "react";
import { Browser, Events } from "@wailsio/runtime";
import { Loader2, RefreshCw } from "lucide-react";
import { UpdateService, type UpdateInfo } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";

// Relay never downloads or installs updates itself: a newer release opens
// its GitHub page, where the download and opening steps are.

function useUpdateToast() {
  const toast = useToast();
  const shown = useRef("");
  return (info: UpdateInfo) => {
    if (!info.available || shown.current === info.latest) return;
    shown.current = info.latest;
    toast(
      {
        tone: "info",
        title: `Relay ${info.latest} is available`,
        body: `You have ${info.current}.`,
        actions: [{ label: "Download", primary: true, onClick: () => Browser.OpenURL(info.url) }],
      },
      30_000,
    );
  };
}

/** Mounted once in App: shows the launch check's result. */
export function UpdateNotifier() {
  const show = useUpdateToast();
  useEffect(() => {
    // The check may have finished before this mounted.
    UpdateService.Status()
      .then((s) => s.last && show(s.last))
      .catch(() => {});
    return Events.On("update:available", (ev) => show(ev.data as UpdateInfo));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Settings header: the running version and a manual check. */
export function UpdateCheck() {
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "new" | "error"; text: string; url?: string } | null>(null);

  useEffect(() => {
    UpdateService.Status()
      .then((s) => setCurrent(s.current))
      .catch(() => {});
  }, []);

  const check = async () => {
    setBusy(true);
    setResult(null);
    try {
      const info = await UpdateService.Check();
      setResult(info.available ? { tone: "new", text: `Relay ${info.latest} is available.`, url: info.url } : { tone: "ok", text: "You're up to date." });
    } catch (err) {
      setResult({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2 text-dim">
      {current && <span>Relay {current}</span>}
      <button className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline disabled:opacity-60" onClick={check} disabled={busy}>
        {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
        Check for updates
      </button>
      {result?.tone === "ok" && <span className="text-[#4ade80]">{result.text}</span>}
      {result?.tone === "error" && <span className="text-overdue">{result.text}</span>}
      {result?.tone === "new" && (
        <button className="text-[#fbbf24] hover:underline" onClick={() => result.url && Browser.OpenURL(result.url)}>
          {result.text} Download
        </button>
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
