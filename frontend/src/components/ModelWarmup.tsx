import { useEffect, useState } from "react";
import { Events } from "@wailsio/runtime";
import { Loader2 } from "lucide-react";
import { AIService, type AIPreload } from "@/lib/api";

/**
 * Starts loading the selected local model into memory. Call it when the
 * user is about to ask the model something (opening Ship, pointing
 * at an AI draft button), never in the background. Go ignores it unless the
 * model is a local Ollama or LM Studio and preloading is on.
 */
export function preloadModel() {
  AIService.Preload().catch(() => {});
}

/** Props that preload when the pointer or focus reaches an AI button. */
export const preloadOnIntent = { onPointerEnter: preloadModel, onFocus: preloadModel };

/** A quiet line while a preload runs: "Loading Ollama · llama3…". */
export function WarmupNote({ className }: { className?: string }) {
  const [p, setP] = useState<AIPreload | null>(null);
  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined;
    const off = Events.On("ai:preload", (ev) => {
      const next = ev.data as AIPreload;
      clearTimeout(hide);
      setP(next);
      if (next.state !== "loading") hide = setTimeout(() => setP(null), 2500);
    });
    return () => {
      off();
      clearTimeout(hide);
    };
  }, []);
  if (!p || p.state === "failed") return null;
  return (
    <span className={className ?? "inline-flex items-center gap-1.5 text-xs text-dim"} role="status">
      {p.state === "loading" ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-[#4ade80]" />}
      {p.state === "loading" ? `Loading ${p.label}…` : `${p.label} is ready`}
    </span>
  );
}
