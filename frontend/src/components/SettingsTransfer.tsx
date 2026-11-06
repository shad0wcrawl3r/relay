import { useState } from "react";
import { Check, Copy, Download, FolderOpen, KeyRound, Loader2, Upload } from "lucide-react";
import { Clipboard } from "@wailsio/runtime";
import { SettingsService, type ExportResult, type ImportResult } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Moving Relay to another computer: export seals the settings and API keys
// into a file in Downloads that only opens with a six-word passphrase; import
// asks for the words. All offline. See backupservice.go.

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function ExportSettingsButton({ onError }: { onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      setResult(await SettingsService.ExportSettings());
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="outline" size="md" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        Export settings
      </Button>
      <ExportDialog result={result} onClose={() => setResult(null)} />
    </>
  );
}

function ExportDialog({ result, onClose }: { result: ExportResult | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!result) return;
    Clipboard.SetText(result.passphrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Dialog open={!!result} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Settings exported</DialogTitle>
          <DialogDescription>
            Saved to <span className="break-all font-mono text-xs text-foreground">{result?.path}</span>. It holds your settings and API keys, locked with
            these words.
          </DialogDescription>
        </DialogHeader>

        <ol className="m-0 grid grid-cols-3 gap-2 p-0" aria-label="Passphrase">
          {result?.words.map((w, i) => (
            <li key={i} className="flex items-baseline gap-2 rounded-lg border border-column-border bg-column px-3 py-2">
              <span className="w-3 text-right font-mono text-[11px] text-dim">{i + 1}</span>
              <span className="selectable font-mono text-[14px] text-strong">{w}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-muted-foreground">
          <p className="m-0 font-medium text-strong">To use it on another computer</p>
          <ol className="m-0 flex flex-col gap-1 pl-5">
            <li>Copy {result ? fileName(result.path) : "the file"} there: a USB stick, AirDrop, or a cloud folder.</li>
            <li>Install Relay and open Settings → Storage → Import settings, or Import on the setup guide's first page.</li>
            <li>Pick the file and type the six words in order.</li>
          </ol>
          <p className="m-0 text-xs text-dim">
            Write the words down or keep them in a password manager, and keep them apart from the file: together they unlock your API keys. Relay doesn't
            store them. Lost them? Export again on this computer; while your settings haven't changed, you get the same words, and they open this file too.
            Buffer and Plane sign-ins aren't included: sign in again on the new computer.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="md" className="mr-auto" onClick={() => result && SettingsService.RevealExport(result.path)}>
            <FolderOpen className="size-3.5" />
            Show file
          </Button>
          <Button variant="outline" size="md" onClick={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy words"}
          </Button>
          <Button size="md" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ImportProps {
  onImported?: (result: ImportResult) => void;
  onError: (message: string) => void;
  variant?: "button" | "link";
  label?: string;
}

export function ImportSettingsButton({ onImported, onError, variant = "button", label = "Import settings" }: ImportProps) {
  const [path, setPath] = useState("");
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<ImportResult | null>(null);

  const choose = async () => {
    try {
      const picked = await SettingsService.ChooseSettingsFile();
      if (picked) {
        setPath(picked);
        setWords("");
        setError("");
        setDone(null);
      }
    } catch (err) {
      onError(errorMessage(err));
    }
  };
  const close = () => {
    if (busy) return;
    setPath("");
    setWords("");
  };
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await SettingsService.ImportSettings(path, words);
      setDone(r);
      onImported?.(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const count = words.split(/[^a-zA-Z]+/).filter(Boolean).length;

  return (
    <>
      {variant === "link" ? (
        <button className="text-[#93c5fd] hover:underline" onClick={choose}>
          {label}
        </button>
      ) : (
        <Button variant="outline" size="md" onClick={choose}>
          <Upload className="size-3.5" />
          {label}
        </Button>
      )}
      <Dialog open={!!path} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {done ? (
            <>
              <DialogHeader>
                <DialogTitle>Settings imported</DialogTitle>
                <DialogDescription>Brought in: {done.imported.join(", ")}.</DialogDescription>
              </DialogHeader>
              <ul className="m-0 flex flex-col gap-1 pl-5 text-[13px] leading-relaxed text-muted-foreground">
                <li>Sign in to Buffer and Plane again; sign-ins stay with the computer they were made on.</li>
                {done.shellKept && <li>The exported terminal shell isn't on this computer, so Relay kept the current one.</li>}
              </ul>
              <DialogFooter>
                <Button size="md" onClick={close}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                run();
              }}
            >
              <DialogHeader>
                <DialogTitle>Import settings</DialogTitle>
                <DialogDescription>
                  Type the six words shown when <span className="break-all font-mono text-xs text-foreground">{fileName(path)}</span> was exported. Its
                  settings and API keys replace the ones on this computer; projects locked here stay locked.
                </DialogDescription>
              </DialogHeader>
              <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <KeyRound className="size-3" />
                  Passphrase
                </span>
                <Input
                  autoFocus
                  value={words}
                  onChange={(e) => setWords(e.target.value)}
                  placeholder="six words, in order"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
                <span className="text-dim">{count === 0 ? "Any case; spaces or hyphens between words." : `${count} of 6 words`}</span>
              </label>
              {error && <p className="m-0 text-xs text-overdue">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="ghost" size="md" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" size="md" disabled={busy || count === 0}>
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  {busy ? "Unlocking…" : "Import"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
