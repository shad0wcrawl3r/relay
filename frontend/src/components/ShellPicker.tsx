import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { TerminalService, type Shell } from "@/lib/api";
import { cn } from "@/lib/utils";

// The shells installed on this machine, for new terminal sessions. Windows
// has no zsh or bash by default, so Relay offers what's actually there:
// PowerShell, Command Prompt, Git Bash, WSL, or whatever /etc/shells lists.

interface Props {
  /** Chosen shell path; "" means the default (the first listed). */
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
}

export function ShellPicker({ value, onChange, disabled }: Props) {
  const [shells, setShells] = useState<Shell[] | null>(null);
  useEffect(() => {
    TerminalService.Shells().then(
      (c) => setShells(c.shells),
      () => setShells([]),
    );
  }, []);

  if (!shells) return <Loader2 className="size-4 animate-spin text-dim" />;
  if (shells.length === 0) return <p className="m-0 text-xs text-dim">No shells found. Relay will try the system default.</p>;

  // Two installs of one shell (say, the system zsh and Homebrew's) need
  // their paths to tell apart, so paths are always shown.
  const chosen = value || shells.find((s) => s.default)?.path || shells[0].path;
  return (
    <div role="radiogroup" aria-label="Shell" className="flex flex-col gap-1">
      {shells.map((s) => {
        const on = s.path === chosen;
        return (
          <button
            key={s.path}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(s.default ? "" : s.path)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left disabled:opacity-60",
              on ? "border-[#3b82f6]/60 bg-[#3b82f6]/10" : "border-column-border bg-column hover:border-[#3f3f46]",
            )}
          >
            <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-[#93c5fd] bg-[#93c5fd]" : "border-[#52525b]")}>
              {on && <Check className="size-3 text-background" strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[13px] text-strong">
                {s.name}
                {s.default && <span className="rounded bg-[#27272a] px-1.5 py-px text-[10px] font-medium text-muted-foreground">Default</span>}
              </span>
              <span className="block truncate font-mono text-[11px] text-dim">{s.path}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
