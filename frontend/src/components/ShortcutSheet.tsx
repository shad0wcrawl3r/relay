import { useMemo } from "react";
import { SHORTCUTS, type ShortcutGroup } from "@/lib/shortcuts";
import { useTerminal } from "@/lib/terminal";
import { Kbd } from "@/components/bits";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** tmux notation ("C-b", "M-Left") as keys to show. */
const keyLabel = (k: string) =>
  k
    .replace(/^C-/, "⌃")
    .replace(/^M-/, "⌥")
    .replace(/^S-/, "⇧")
    .replace(/C-/g, "⌃")
    .replace(/M-/g, "⌥")
    .replace("Left", "←")
    .replace("Right", "→")
    .replace("Up", "↑")
    .replace("Down", "↓")
    .replace("Enter", "↵")
    .replace("Space", "Space");

const actionLabel = (action: string, arg: string) => {
  const words = action.replace(/-/g, " ");
  return (words.charAt(0).toUpperCase() + words.slice(1) + (arg ? ` ${arg}` : "")).trim();
};

/** ⌘? — every shortcut, grouped by where it works. The terminal's come from its keymap (your tmux config, if any). */
export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { keymap } = useTerminal();
  const groups = useMemo<ShortcutGroup[]>(() => {
    if (!keymap) return SHORTCUTS;
    const prefix = keyLabel(keymap.prefix);
    const terminal: ShortcutGroup = {
      title: "Terminal",
      where: keymap.source ? `from ${keymap.source}` : `after the prefix, ${prefix}`,
      items: [
        { keys: [prefix], label: "Prefix" },
        ...keymap.bindings.slice(0, 24).map((b) => ({ keys: b.root ? [keyLabel(b.key)] : [prefix, keyLabel(b.key)], label: actionLabel(b.action, b.arg) })),
      ],
    };
    return [...SHORTCUTS, terminal];
  }, [keymap]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[860px]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>⌘ is Ctrl on Windows and Linux.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 max-h-[65vh] columns-1 gap-8 overflow-y-auto pr-1 sm:columns-2 lg:columns-3">
          {groups.map((g) => (
            <section key={g.title} className="mb-5 break-inside-avoid">
              <h3 className="m-0 mb-2 text-[11px] font-medium uppercase tracking-[.06em] text-dim">
                {g.title}
                {g.where && <span className="ml-1.5 normal-case tracking-normal">· {g.where}</span>}
              </h3>
              <dl className="m-0 flex flex-col gap-1.5">
                {g.items.map((s) => (
                  <div key={s.label + s.keys.join()} className="flex items-center justify-between gap-3 text-[13px]">
                    <dt className="text-muted-foreground">{s.label}</dt>
                    <dd className="m-0 flex shrink-0 gap-1">
                      {s.keys.map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
