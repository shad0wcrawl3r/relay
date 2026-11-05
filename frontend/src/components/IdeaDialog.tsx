import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { AIService, BufferService, type BufferIdea, type BufferIdeaGroup } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Creates a Buffer idea, optionally drafted with AI from pasted text. */
export function IdeaDialog({
  orgId,
  groups,
  onClose,
  onCreated,
}: {
  orgId: string;
  groups: BufferIdeaGroup[];
  onClose: () => void;
  onCreated: (i: BufferIdea) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [groupId, setGroupId] = useState("");
  const [source, setSource] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiReady, setAiReady] = useState(false);

  useEffect(() => {
    AIService.Status()
      .then((s) => setAiReady(s.ready))
      .catch(() => {});
  }, []);

  const draft = async () => {
    setDrafting(true);
    try {
      setText(await AIService.SummarizeText(title, source));
    } catch (err) {
      toast({ tone: "error", title: "Couldn't draft the idea", body: errorMessage(err) });
    } finally {
      setDrafting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      onCreated(await BufferService.CreateIdea({ organizationId: orgId, groupId, title, text }));
    } catch (err) {
      toast({ tone: "error", title: "Couldn't save the idea", body: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-w-[600px] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>New idea</DialogTitle>
          <DialogDescription>Saved to Buffer's Ideas. Nothing is posted.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Title" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <details className="rounded-md border border-border p-3 text-xs text-muted-foreground" open={!!source}>
          <summary className="cursor-pointer select-none">
            <Sparkles className="mr-1 inline size-3.5" /> Draft from pasted text with AI
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            <textarea
              aria-label="Text to summarise"
              placeholder="Paste an article, notes or a README. It's sent to your AI provider only when you press Draft."
              value={source}
              onChange={(e) => setSource(e.target.value)}
              rows={6}
              className="w-full resize-y rounded-md border border-border bg-[#0f0f11] p-2.5 text-xs text-[#f4f4f5] outline-none focus:border-border-strong"
            />
            <div className="flex items-center gap-2">
              <Button variant="teal" onClick={draft} disabled={!aiReady || drafting || !source.trim()}>
                {drafting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                Draft
              </Button>
              {!aiReady && <span>Set up an AI provider in Settings to draft.</span>}
            </div>
          </div>
        </details>
        <textarea
          aria-label="Idea text"
          placeholder="What's the idea?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          className="w-full resize-y rounded-md border border-border bg-[#0f0f11] p-3 text-[13px] leading-snug text-[#f4f4f5] outline-none focus:border-border-strong"
        />
        {groups.length > 0 && (
          <label className="flex items-center gap-3 text-xs text-muted-foreground">
            Group
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="h-[30px] rounded-md border border-border bg-[#111113] px-2 text-xs text-[#d4d4d8]"
            >
              <option value="">Unassigned</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || (!text.trim() && !title.trim())}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Save idea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
