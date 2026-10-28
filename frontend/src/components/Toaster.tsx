import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: "success" | "error" | "info";
  actions?: ToastAction[];
}

type Push = (t: Omit<Toast, "id">, ms?: number) => void;
const ToastCtx = createContext<Push>(() => {});

export const useToast = () => useContext(ToastCtx);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>(
    (t, ms) => {
      const id = nextId++;
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      const ttl = ms ?? (t.actions?.length ? 12000 : t.tone === "error" ? 8000 : 4000);
      if (ttl > 0) setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-[84px] right-6 z-[60] flex w-[380px] max-w-[calc(100%-48px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex gap-3 rounded-[10px] border border-border bg-background p-4 shadow-[0_16px_40px_rgba(0,0,0,.5)]"
          >
            {t.tone === "error" ? (
              <AlertCircle className="mt-px size-5 shrink-0 text-[#f87171]" strokeWidth={1.9} />
            ) : (
              <CheckCircle2 className="mt-px size-5 shrink-0 text-[#4ade80]" strokeWidth={1.9} />
            )}
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
            {!t.actions && (
              <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="-mr-1 -mt-1 grid size-6 place-items-center rounded text-dim hover:text-strong">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
