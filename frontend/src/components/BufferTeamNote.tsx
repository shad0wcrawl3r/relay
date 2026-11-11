import { useState } from "react";
import { Browser } from "@wailsio/runtime";
import { ExternalLink, Mail, X } from "lucide-react";
import { loadPref, savePref } from "@/lib/prefs";
import { REPO } from "@/lib/bugReport";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Shown on the Buffer tab only when the signed-in Buffer account is a
// buffer.com address. Go decides that (BufferOverview.Staff); only the flag
// reaches the UI. The text is public in the repo anyway.

const LINKS = [
  { label: "shadowcrawler.dev", url: "https://shadowcrawler.dev" },
  { label: "GitHub", url: "https://github.com/shad0wcrawl3r" },
  { label: "Relay's source", url: REPO },
];
const DISMISSED = "relay.buffernote.dismissed";

export function BufferTeamNote() {
  const [hidden, setHidden] = useState(() => loadPref(DISMISSED, false));
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  return (
    <>
      <div className="mb-4 flex items-center gap-3 rounded-[10px] border border-[rgba(147,197,253,.25)] bg-[rgba(147,197,253,.04)] px-4 py-2.5 text-[13px]">
        <Mail className="size-4 shrink-0 text-[#93c5fd]" />
        <span className="grow text-muted-foreground">You're signed in from Buffer. The person who built Relay left you a note.</span>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Read me
        </Button>
        <button
          aria-label="Dismiss"
          className="grid size-6 shrink-0 place-items-center rounded text-dim hover:text-strong"
          onClick={() => {
            savePref(DISMISSED, true);
            setHidden(true);
          }}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex flex-col gap-[18px]">
          <DialogHeader>
            <DialogTitle>Hi, Buffer team</DialogTitle>
            <DialogDescription>Since you're here, I'd like to request a couple of changes in your flow.</DialogDescription>
          </DialogHeader>
          <ol className="m-0 flex list-decimal flex-col gap-3 pl-5 text-[13px] leading-normal text-foreground">
            <li>
              <span className="font-medium text-strong">Add Dev.to scheduling.</span> This project stems from the fact that Buffer has no scheduling for Dev.to, so Relay writes and
              publishes there itself and hands Buffer the promotion. A Dev.to channel would make that one step.
            </li>
            <li>
              <span className="font-medium text-strong">Consider me for your team.</span> I'd love to bring this kind of work to Buffer in security, infrastructure or
              wherever I'd be most useful. Relay is a good look at how I build, and I'd be glad to work alongside a team like yours.
            </li>
          </ol>
          <p className="m-0 text-[13px] text-muted-foreground">Thanks for reading, and for Buffer Commit. — Ashwin</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
            {LINKS.map((l) => (
              <button key={l.url} className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline" onClick={() => Browser.OpenURL(l.url)}>
                <ExternalLink className="size-3" />
                {l.label}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button size="md" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
