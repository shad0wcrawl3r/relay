import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { UpdateService, type ChangelogEntry } from "@/lib/api";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// The changelog is CHANGELOG.md, built into the app by Go. It's plain text:
// nothing in it is rendered as markup or links.

const day = (iso: string) => {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: "medium" });
};

function Changes({ changes }: { changes: string[] }) {
  if (changes.length === 0) return <p className="m-0 text-[13px] text-dim">No changes listed.</p>;
  return (
    <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-[#d4d4d8] marker:text-dim">
      {changes.map((c, i) => (
        <li key={i} className="select-text">
          {c}
        </li>
      ))}
    </ul>
  );
}

/** Settings → About: every release's changes, one collapsible per version. */
export function ChangelogList({ current }: { current: string }) {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  useEffect(() => {
    UpdateService.Changelog().then(setEntries, () => setEntries([]));
  }, []);
  if (!entries) return null;
  if (entries.length === 0) return <p className="m-0 text-[13px] text-dim">No changelog in this build.</p>;

  // The running version starts open; in dev builds that's Unreleased.
  const open = entries.find((e) => e.version === current)?.version ?? entries[0].version;
  return (
    <Accordion type="multiple" defaultValue={[open]} className="overflow-hidden rounded-[10px] border border-column-border bg-column">
      {entries.map((e) => (
        <AccordionItem key={e.version} value={e.version}>
          <AccordionTrigger>
            <span className="flex items-baseline gap-2">
              <span className="font-mono font-medium">{e.version}</span>
              {e.version === current && <span className="rounded bg-accent px-1.5 py-px text-[11px] text-dim">This version</span>}
              {e.date && <span className="text-[12px] text-dim">{day(e.date)}</span>}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <Changes changes={e.changes} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

/**
 * What's new: shown once, the first time Relay opens after an update. Go
 * decides whether there's anything to show (never on a fresh install or in
 * dev builds); closing it records the version as seen.
 */
export function WhatsNewDialog({ onShowAll }: { onShowAll: () => void }) {
  const [version, setVersion] = useState("");
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    UpdateService.WhatsNew().then(
      (w) => {
        if (w.entries.length === 0) return;
        setVersion(w.version);
        setEntries(w.entries);
        setOpen(true);
      },
      () => {},
    );
  }, []);

  const close = (then?: () => void) => {
    setOpen(false);
    UpdateService.MarkSeen().catch(() => {});
    then?.();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-[#818cf8]" />
            Relay updated to {version}
          </DialogTitle>
          <DialogDescription>Here's what changed{entries.length > 1 ? ` in the ${entries.length} releases since you last opened it` : ""}.</DialogDescription>
        </DialogHeader>
        <div className="my-4 flex max-h-[55vh] flex-col gap-4 overflow-y-auto pr-1">
          {entries.map((e) => (
            <div key={e.version} className="flex flex-col gap-2">
              {entries.length > 1 && (
                <h3 className="m-0 flex items-baseline gap-2 text-[13px] font-medium text-strong">
                  <span className="font-mono">{e.version}</span>
                  {e.date && <span className="text-[12px] font-normal text-dim">{day(e.date)}</span>}
                </h3>
              )}
              <Changes changes={e.changes} />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="md" onClick={() => close(onShowAll)}>
            All changes
          </Button>
          <Button size="md" onClick={() => close()}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
