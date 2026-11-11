import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export type Tone = "success" | "error" | "info";

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: Tone;
  actions?: ToastAction[];
  /**
   * Also keep it in the notification pane. Errors are kept unless this is
   * false; anything else only when it's true. Undo toasts shouldn't be kept:
   * their action goes stale.
   */
  keep?: boolean;
}

/** A kept toast in the notification pane. In memory only. */
export interface Notice {
  id: number;
  title: string;
  body?: string;
  tone: Tone;
  actions?: ToastAction[];
  at: number;
  read: boolean;
}

type Push = (t: Omit<Toast, "id">, ms?: number) => void;
const ToastCtx = createContext<Push>(() => {});

interface Inbox {
  notices: Notice[];
  unread: number;
  markRead: () => void;
  remove: (id: number) => void;
  clear: () => void;
}
const InboxCtx = createContext<Inbox>({ notices: [], unread: 0, markRead: () => {}, remove: () => {}, clear: () => {} });

export const useToast = () => useContext(ToastCtx);
export const useInbox = () => useContext(InboxCtx);

/** Notices kept at most; the oldest go first. */
const MAX_NOTICES = 50;

let nextId = 1;

export const ToneIcon = ({ tone, className = "mt-px size-5 shrink-0" }: { tone: Tone; className?: string }) =>
  tone === "error" ? (
    <AlertCircle className={`${className} text-[#f87171]`} strokeWidth={1.9} />
  ) : tone === "info" ? (
    <Info className={`${className} text-[#93c5fd]`} strokeWidth={1.9} />
  ) : (
    <CheckCircle2 className={`${className} text-[#4ade80]`} strokeWidth={1.9} />
  );

interface Timer {
  handle?: ReturnType<typeof setTimeout>;
  // Time left when paused, and when the running timer started.
  left: number;
  started: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const timers = useRef(new Map<number, Timer>());

  // The list lives in a ref too, so push can work out what to replace
  // without side effects inside a state updater.
  const shown = useRef<Toast[]>([]);
  const show = useCallback((next: Toast[]) => {
    shown.current = next;
    setToasts(next);
  }, []);
  const stop = (id: number) => {
    const t = timers.current.get(id);
    if (t?.handle) clearTimeout(t.handle);
    timers.current.delete(id);
  };

  const dismiss = useCallback(
    (id: number) => {
      stop(id);
      show(shown.current.filter((x) => x.id !== id));
    },
    [show],
  );

  const run = useCallback(
    (id: number) => {
      const t = timers.current.get(id);
      if (!t || t.left <= 0) return;
      t.started = Date.now();
      t.handle = setTimeout(() => dismiss(id), t.left);
    },
    [dismiss],
  );
  // The pointer over a toast holds it; leaving gives it what was left, but
  // at least a couple of seconds to read.
  const pause = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (!t?.handle) return;
    clearTimeout(t.handle);
    t.handle = undefined;
    t.left = Math.max(2000, t.left - (Date.now() - t.started));
  }, []);

  const push = useCallback<Push>(
    (t, ms) => {
      const id = nextId++;
      const keep = t.keep ?? t.tone === "error";
      if (keep) {
        setNotices((ns) => [{ id, title: t.title, body: t.body, tone: t.tone, actions: t.actions, at: Date.now(), read: false }, ...ns].slice(0, MAX_NOTICES));
      }
      // The same message again (a sync failing each interval) replaces the
      // one on screen instead of stacking. At most four show at once.
      const rest = shown.current.filter((x) => !(x.title === t.title && x.body === t.body));
      shown.current.filter((x) => !rest.includes(x)).forEach((x) => stop(x.id));
      const kept = rest.slice(-3);
      rest.filter((x) => !kept.includes(x)).forEach((x) => stop(x.id));
      show([...kept, { ...t, id }]);
      // Errors stay until closed; they're also in the notification pane.
      const ttl = ms ?? (t.tone === "error" ? 0 : t.actions?.length ? 12000 : 4000);
      timers.current.set(id, { left: ttl, started: Date.now() });
      if (ttl > 0) run(id);
    },
    [run, show],
  );

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => t.handle && clearTimeout(t.handle));
  }, []);

  const inbox = useMemo<Inbox>(
    () => ({
      notices,
      unread: notices.filter((n) => !n.read).length,
      markRead: () => setNotices((ns) => (ns.some((n) => !n.read) ? ns.map((n) => ({ ...n, read: true })) : ns)),
      remove: (id) => setNotices((ns) => ns.filter((n) => n.id !== id)),
      clear: () => setNotices([]),
    }),
    [notices],
  );

  return (
    <ToastCtx.Provider value={push}>
      <InboxCtx.Provider value={inbox}>
        {children}
        <div
          className="pointer-events-none fixed bottom-[84px] right-6 z-[60] flex w-[380px] max-w-[calc(100%-48px)] flex-col gap-2"
          aria-live="polite"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              onPointerEnter={() => pause(t.id)}
              onPointerLeave={() => run(t.id)}
              onFocus={() => pause(t.id)}
              onBlur={() => run(t.id)}
              className="pointer-events-auto flex gap-3 rounded-[10px] border border-border bg-background p-4 shadow-[0_16px_40px_rgba(0,0,0,.5)]"
            >
              <ToneIcon tone={t.tone} />
              <div className="flex min-w-0 grow flex-col gap-1">
                <span className="text-sm font-semibold text-strong">{t.title}</span>
                {t.body && <span className="selectable break-words text-[13px] leading-normal text-muted-foreground">{t.body}</span>}
                {t.actions && (
                  <div className="mt-2 flex gap-2">
                    {t.actions.map((a) => (
                      <Button
                        key={a.label}
                        size="md"
                        variant={a.primary ? "default" : "outline"}
                        onClick={() => {
                          a.onClick();
                          dismiss(t.id);
                        }}
                      >
                        {a.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <button
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
                className="-mr-1 -mt-1 grid size-6 shrink-0 place-items-center rounded text-dim hover:text-strong focus-visible:outline focus-visible:outline-1 focus-visible:outline-border-strong"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </InboxCtx.Provider>
    </ToastCtx.Provider>
  );
}
