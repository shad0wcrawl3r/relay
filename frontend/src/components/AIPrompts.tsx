import { useEffect, useState } from "react";
import { ChevronRight, RotateCcw } from "lucide-react";
import { AIService, type AIPrompt } from "@/lib/api";
import { cn, errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toaster";

/**
 * Settings → AI → Prompts: rewrite the instructions behind each AI action.
 * Only the system prompt is editable; the article or notes still go in a
 * fenced user message, privacy rules still decide where they may go, and
 * text Relay parses (Ship's reply format) is added after, shown read-only.
 */
export function AIPrompts() {
  const toast = useToast();
  const [prompts, setPrompts] = useState<AIPrompt[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    AIService.Prompts().then(setPrompts, () => setPrompts([]));
  }, []);

  const save = async (id: string, text: string) => {
    try {
      setPrompts(await AIService.SetPrompt(id, text));
      toast({ tone: "success", title: text.trim() ? "Prompt saved" : "Prompt reset" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't save the prompt", body: errorMessage(err) });
    }
  };

  if (!prompts?.length) return null;
  return (
    <section className="flex flex-col gap-3" aria-label="Prompts">
      <div>
        <h2 className="m-0 text-[15px] font-semibold text-strong">Prompts</h2>
        <p className="mt-1 text-[13px] text-dim">
          The instructions Relay gives the model for each AI action. Change the voice, length or rules; your article or notes are added separately. Saved in
          Relay's settings file as plain text, so keep secrets out.
        </p>
      </div>
      <div className="flex flex-col divide-y divide-border rounded-[10px] border border-border">
        {prompts.map((p) => (
          <PromptRow key={p.id} prompt={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onSave={(text) => save(p.id, text)} />
        ))}
      </div>
    </section>
  );
}

function PromptRow({ prompt, open, onToggle, onSave }: { prompt: AIPrompt; open: boolean; onToggle: () => void; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState(prompt.text);
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(prompt.text), [prompt.text]);
  const dirty = text.trim() !== prompt.text.trim();
  const run = async (t: string) => {
    setSaving(true);
    await onSave(t);
    setSaving(false);
  };

  return (
    <div className="flex flex-col">
      <button aria-expanded={open} onClick={onToggle} className="flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-[#141417]">
        <ChevronRight className={cn("size-3.5 shrink-0 text-dim transition-transform", open && "rotate-90")} />
        <span className="text-[13px] font-medium text-strong">{prompt.name}</span>
        {prompt.custom && <span className="rounded border border-border px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Custom</span>}
        <span className="ml-auto truncate text-xs text-dim">{prompt.use}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3.5 pb-3.5">
          <textarea
            aria-label={`${prompt.name} prompt`}
            value={text}
            rows={10}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            className="w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs leading-relaxed text-strong outline-none focus:border-[#52525b]"
          />
          {(prompt.placeholders ?? []).length > 0 && (
            <p className="m-0 text-xs text-dim">
              <code className="font-mono text-muted-foreground">{prompt.placeholders.join(", ")}</code> becomes the character limit for the channels you picked. Leave it
              out and Relay adds the limit on its own line.
            </p>
          )}
          {prompt.fixed && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-dim">Always added after, because Relay reads the reply in this format:</span>
              <pre className="m-0 whitespace-pre-wrap rounded-md border border-border bg-column px-3 py-2 font-mono text-[11px] leading-relaxed text-dim">{prompt.fixed}</pre>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button size="md" disabled={!dirty || saving || !text.trim()} onClick={() => run(text)}>
              Save
            </Button>
            {dirty && (
              <Button variant="ghost" size="md" disabled={saving} onClick={() => setText(prompt.text)}>
                Discard changes
              </Button>
            )}
            {(prompt.custom || text.trim() !== prompt.default.trim()) && (
              <Button variant="outline" size="md" className="ml-auto" disabled={saving} onClick={() => run("")}>
                <RotateCcw className="size-3.5" /> Reset to Relay's
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
