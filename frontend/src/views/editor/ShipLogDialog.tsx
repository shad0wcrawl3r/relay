import { useEffect, useMemo, useState } from "react";
import { FolderGit2, Loader2, Sparkles, X } from "lucide-react";
import { AIService, BufferService, ShipLogService, type AIStatus, type BufferChannel, type Post, type ShipLogMaterial, type ShipProject } from "@/lib/api";
import { useIntegrations } from "@/lib/integrations";
import { strictestLimit } from "@/components/ComposeDialog";
import { BufferLogo } from "@/components/icons/BufferLogo";
import { cn, errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 14, label: "Last 14 days" },
  { days: 30, label: "Last 30 days" },
];

const dayInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayInput(d);
};
const shortDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Ship log: drafts a build-in-public post from work finished in a date
 * range (completed Plane or Buffer-board items, plus commits from a repo
 * you pick). You choose what goes in; the model drafts; the result opens as
 * a new post.
 */
export function ShipLogDialog({
  onClose,
  onDrafted,
  onSocial,
}: {
  onClose: () => void;
  onDrafted: (p: Post) => void;
  /** A short post for Buffer, to finish in the composer. */
  onSocial: (text: string, channels: BufferChannel[]) => void;
}) {
  const bufferOn = useIntegrations().buffer === true;
  const [channels, setChannels] = useState<BufferChannel[] | null>(null);
  const [since, setSince] = useState(() => daysAgo(7));
  const [projects, setProjects] = useState<ShipProject[]>([]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [repo, setRepo] = useState("");
  const [material, setMaterial] = useState<ShipLogMaterial | null>(null);
  const [finding, setFinding] = useState(false);
  const [dropItems, setDropItems] = useState<Set<string>>(new Set());
  const [dropCommits, setDropCommits] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [ai, setAi] = useState<AIStatus | null>(null);
  const [drafting, setDrafting] = useState<"" | "post" | "social">("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (bufferOn) BufferService.Channels().then(setChannels, () => setChannels([]));
  }, [bufferOn]);

  useEffect(() => {
    ShipLogService.Projects().then(
      (ps) => {
        setProjects(ps);
        setPicked(ps.map((p) => p.id));
      },
      () => setPicked([]),
    );
    ShipLogService.RecentRepo().then(setRepo, () => {});
    AIService.Status().then(setAi, () => {});
  }, []);

  const query = useMemo(
    () => ({ since: new Date(`${since}T00:00:00`).toISOString(), until: new Date().toISOString(), projectIds: picked ?? [], repo }),
    [since, picked, repo],
  );

  // Look again whenever the window or sources change.
  useEffect(() => {
    if (picked === null) return;
    let stale = false;
    setFinding(true);
    setError("");
    const t = setTimeout(() => {
      ShipLogService.Material(query)
        .then((m) => {
          if (stale) return;
          setMaterial(m);
          setDropItems(new Set());
          setDropCommits(new Set());
        })
        .catch((err) => !stale && setError(errorMessage(err)))
        .finally(() => !stale && setFinding(false));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query, picked]);

  const chooseRepo = async () => {
    try {
      const dir = await ShipLogService.ChooseRepo();
      if (dir) {
        setRepo(dir);
        ShipLogService.SetRecentRepo(dir).catch(() => {});
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const clearRepo = () => {
    setRepo("");
    ShipLogService.SetRecentRepo("").catch(() => {});
  };

  const items = material?.items ?? [];
  const commits = material?.commits ?? [];
  const keptItems = items.filter((i) => !dropItems.has(i.id));
  const keptCommits = commits.filter((c) => !dropCommits.has(c.hash));
  const ready = !!ai?.ready && !drafting && !finding && (keptItems.length > 0 || keptCommits.length > 0 || notes.trim() !== "");
  const range = RANGES.find((r) => daysAgo(r.days) === since);

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  const kept = () => ({ query, itemIds: keptItems.map((i) => i.id), commits: keptCommits.map((c) => c.hash), notes });

  const draft = async () => {
    setDrafting("post");
    setError("");
    try {
      onDrafted(await ShipLogService.Draft(kept()));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDrafting("");
    }
  };

  // Sized for the strictest channel, so one post fits them all.
  const draftSocial = async () => {
    if (!channels) return;
    setDrafting("social");
    setError("");
    try {
      onSocial(await ShipLogService.DraftSocial(kept(), strictestLimit(channels)), channels);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDrafting("");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !drafting && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-[640px] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Ship log</DialogTitle>
          <DialogDescription>
            Draft a build-in-public update from what you finished. Pick what goes in; AI writes an article you edit like any post
            {bufferOn ? ", or a short post you finish in the Buffer composer" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Date range">
            {RANGES.map((r) => (
              <Chip key={r.days} on={range?.days === r.days} onClick={() => setSince(daysAgo(r.days))}>
                {r.label}
              </Chip>
            ))}
            <label className="ml-1 inline-flex items-center gap-2 text-xs text-dim">
              Since
              <Input type="date" aria-label="Since" value={since} max={dayInput(new Date())} onChange={(e) => e.target.value && setSince(e.target.value)} className="h-8 w-auto text-[13px]" />
            </label>
          </div>

          {projects.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Projects</span>
              <div className="flex flex-wrap gap-2">
                {projects.map((p) => (
                  <Chip
                    key={p.id}
                    on={!!picked?.includes(p.id)}
                    onClick={() => setPicked((cur) => (cur?.includes(p.id) ? cur.filter((x) => x !== p.id) : [...(cur ?? []), p.id]))}
                  >
                    {p.name}
                    {p.source === "buffer" && <span className="text-dim"> · Buffer</span>}
                  </Chip>
                ))}
              </div>
              {(material?.skipped ?? 0) > 0 && <p className="m-0 text-xs text-dim">Private projects are always left out.</p>}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Commits (optional)</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="md" onClick={chooseRepo}>
                <FolderGit2 className="size-3.5" />
                {repo ? "Change repository" : "Choose a repository"}
              </Button>
              {repo && (
                <span className="inline-flex min-w-0 items-center gap-1 text-xs text-dim">
                  <span className="truncate" title={repo}>
                    {repo}
                  </span>
                  <button aria-label="Don't read commits" onClick={clearRepo} className="grid size-5 shrink-0 place-items-center rounded hover:text-strong">
                    <X className="size-3" />
                  </button>
                </span>
              )}
            </div>
            {material?.repoError && <p className="m-0 text-xs text-overdue">{material.repoError}</p>}
            <p className="m-0 text-xs text-dim">Only commit subjects are read, never code or diffs.</p>
          </div>

          <section aria-label="What goes in" className="flex flex-col gap-2 rounded-[10px] border border-column-border bg-column p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">What goes in</span>
              {finding ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <span className="text-dim">
                  {keptItems.length} of {items.length} items · {keptCommits.length} of {commits.length} commits
                </span>
              )}
            </div>
            {!finding && items.length === 0 && commits.length === 0 && (
              <p className="m-0 text-xs text-dim">Nothing finished in this range. Try a longer range, another project or a repository, or write notes below.</p>
            )}
            {items.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {items.map((i) => (
                  <Row key={i.id} on={!dropItems.has(i.id)} onClick={() => toggle(dropItems, i.id, setDropItems)} meta={`${i.key} · ${shortDay(i.doneAt)}`}>
                    {i.name}
                  </Row>
                ))}
              </ul>
            )}
            {commits.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {commits.map((c) => (
                  <Row key={c.hash} on={!dropCommits.has(c.hash)} onClick={() => toggle(dropCommits, c.hash, setDropCommits)} meta={`${c.hash} · ${shortDay(c.date)}`} mono>
                    {c.subject}
                  </Row>
                ))}
              </ul>
            )}
          </section>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Your notes (optional)</span>
            <textarea
              value={notes}
              rows={3}
              placeholder="What it was like, what you learned, what's next. The draft only says what's here or above."
              onChange={(e) => setNotes(e.target.value)}
              className="w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-[13px] leading-relaxed text-strong outline-none placeholder:text-dim focus:border-[#52525b]"
            />
          </label>
        </div>

        {error && <p className="m-0 text-[13px] text-overdue">{error}</p>}

        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-dim">
            {ai === null
              ? ""
              : ai.ready
                ? `${ai.local ? `Runs on this machine with ${ai.label}` : `Sends the titles and notes to ${ai.label}`}. An article is marked AI-assisted.`
                : "Connect a model provider in Settings → AI first."}
          </span>
          <Button variant="outline" size="md" disabled={!!drafting} onClick={onClose}>
            Cancel
          </Button>
          {bufferOn && (
            <Button
              variant="outline"
              size="md"
              disabled={!ready || !channels?.length}
              title={channels?.length === 0 ? "No Buffer channels found" : "A short post for your Buffer channels, to review in the composer"}
              onClick={draftSocial}
            >
              {drafting === "social" ? <Loader2 className="size-3.5 animate-spin" /> : <BufferLogo className="size-3.5" />}
              {drafting === "social" ? "Drafting…" : "Buffer post"}
            </Button>
          )}
          <Button size="md" disabled={!ready} onClick={draft}>
            {drafting === "post" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {drafting === "post" ? "Drafting…" : "Draft article"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-pressed={on}
      onClick={onClick}
      className={cn("inline-flex h-8 items-center rounded-md border border-border px-3 text-[13px] text-muted-foreground hover:text-strong", on && "border-border-strong bg-[#18181b] text-strong")}
    >
      {children}
    </button>
  );
}

function Row({ on, onClick, meta, mono, children }: { on: boolean; onClick: () => void; meta: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1 hover:bg-[#141417]">
        <input type="checkbox" checked={on} onChange={onClick} className="mt-[3px] accent-[#60a5fa]" />
        <span className={cn("min-w-0 grow text-[13px] leading-snug", on ? "text-[#e4e4e7]" : "text-dim line-through")}>{children}</span>
        <span className={cn("shrink-0 text-[11px] text-dim", mono && "font-mono")}>{meta}</span>
      </label>
    </li>
  );
}
