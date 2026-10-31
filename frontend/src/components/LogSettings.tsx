import { useEffect, useMemo, useRef, useState } from "react";
import { Clipboard } from "@wailsio/runtime";
import { Check, Copy, Trash2 } from "lucide-react";
import { LogService, type LogEntry, type LogStatus } from "@/lib/api";
import { cn, errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const LEVELS = ["debug", "info", "notice", "warn", "error", "off"];
const MAX_SHOWN = 2000;

const LEVEL_COLOR: Record<string, string> = {
  debug: "text-dim",
  info: "text-muted-foreground",
  notice: "text-[#93c5fd]",
  warn: "text-[#fbbf24]",
  error: "text-[#f87171]",
};

const line = (e: LogEntry) => `${new Date(e.time).toISOString()} ${e.level.padEnd(6)} ${e.subsystem.padEnd(8)} ${e.message} ${e.fields}`.trimEnd();

const selectClass = "h-8 rounded-md border border-border bg-background px-2 text-xs text-strong outline-none focus:border-[#52525b]";

export function LogSettings() {
  const toast = useToast();
  const [status, setStatus] = useState<LogStatus | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [subsystem, setSubsystem] = useState("");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const seq = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    LogService.Status().then(setStatus).catch(() => {});
  }, []);

  const enabled = !!status?.enabled;
  useEffect(() => {
    if (!enabled) return;
    const poll = () =>
      LogService.Entries(seq.current)
        .then((next) => {
          if (next.length === 0) return;
          seq.current = next[next.length - 1].seq;
          setEntries((cur) => [...cur, ...next].slice(-MAX_SHOWN));
        })
        .catch(() => {});
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [enabled]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => (!subsystem || e.subsystem === subsystem) && (!q || line(e).toLowerCase().includes(q)));
  }, [entries, subsystem, search]);

  useEffect(() => {
    const el = list.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  if (!status) return null;

  const update = async (change: Promise<LogStatus>) => {
    try {
      setStatus(await change);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't change logging", body: errorMessage(err) });
    }
  };

  const clear = async () => {
    await LogService.Clear();
    setEntries([]);
  };

  const copy = () => {
    Clipboard.SetText(shown.map(line).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="m-0 text-[15px] font-semibold text-strong">Logging</h2>
            <p className="mt-1 text-[13px] text-dim">
              Kept in memory for this session, newest 5,000 entries, and never written to disk. Tokens and keys are redacted, and article text, prompts and terminal output are
              never logged.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2.5 pt-0.5 text-[13px] text-foreground">
            <Switch checked={status.enabled} onCheckedChange={(v) => update(LogService.SetEnabled(v))} />
            Enabled
          </label>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          {status.subsystems.map((s) => (
            <label key={s.id} className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
              {s.name}
              <select aria-label={`${s.name} log level`} value={s.level} onChange={(e) => update(LogService.SetLevel(s.id, e.target.value))} className={selectClass}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <select aria-label="Filter by subsystem" value={subsystem} onChange={(e) => setSubsystem(e.target.value)} className={selectClass}>
            <option value="">All subsystems</option>
            {status.subsystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Input aria-label="Search logs" value={search} placeholder="Search" onChange={(e) => setSearch(e.target.value)} className="h-8 grow text-xs" />
          <Button variant="outline" size="md" className="h-8" disabled={shown.length === 0} onClick={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            Copy
          </Button>
          <Button variant="outline" size="md" className="h-8" disabled={entries.length === 0} onClick={clear}>
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </div>
        <div
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget;
            following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="h-[380px] overflow-y-auto rounded-[10px] border border-column-border bg-column px-3 py-2 font-mono text-[11px] leading-[18px]"
        >
          {shown.length === 0 ? (
            <p className="m-0 text-dim">{status.enabled ? (entries.length ? "Nothing matches." : "Waiting for log entries…") : "Logging is off."}</p>
          ) : (
            shown.map((e) => (
              <div key={e.seq} className="whitespace-pre-wrap break-words">
                <span className="text-dim-2">{new Date(e.time).toLocaleTimeString()}</span> <span className={cn(LEVEL_COLOR[e.level])}>{e.level}</span>{" "}
                <span className="text-[#c4b5fd]">{e.subsystem}</span> <span className="text-foreground">{e.message}</span> <span className="text-dim">{e.fields}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
