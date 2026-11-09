import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { AIService, type AIStatus, type ModelTest } from "@/lib/api";
import { cn, errorMessage } from "@/lib/utils";
import { ModelPicker } from "@/components/ModelPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/Toaster";

export function AISettings({ compact = false, onChange }: { compact?: boolean; onChange?: (s: AIStatus) => void } = {}) {
  // Narrow windows (the setup guide) stack labels above fields.
  const row = compact ? "flex flex-col gap-2" : "grid grid-cols-[160px_minmax(0,1fr)] items-start gap-4";
  const toast = useToast();
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [picked, setPicked] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  // Saving or removing the key failed; shown under the key field.
  const [keyError, setKeyError] = useState("");
  const [endpoint, setEndpoint] = useState("");
  // The model picked for this provider; it's only saved once it passes a
  // test (or the user saves it anyway).
  const [chosen, setChosen] = useState("");
  const [phase, setPhase] = useState<"idle" | "testing" | "saving">("idle");
  const [tested, setTested] = useState<ModelTest | null>(null);
  const [testError, setTestError] = useState("");
  // Turning "Private provider" on asks first; turning it off doesn't.
  const [confirmPrivate, setConfirmPrivate] = useState(false);

  const provider = status?.providers.find((p) => p.id === picked);
  useEffect(() => {
    if (status) onChange?.(status);
  }, [status, onChange]);

  const loadModels = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    setModels([]);
    try {
      setModels(await AIService.Models(id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const choose = useCallback(
    (id: string, custom: string, needsKey: boolean, keySet: boolean, savedModel: string) => {
      setPicked(id);
      setKey("");
      setEndpoint(custom);
      setChosen(savedModel);
      setKeyError("");
      setTested(null);
      setTestError("");
      setModels([]);
      setError("");
      if (!needsKey || keySet) loadModels(id);
    },
    [loadModels],
  );

  useEffect(() => {
    AIService.Status()
      .then((s) => {
        setStatus(s);
        const current = s.providers.find((p) => p.id === s.provider) ?? s.providers[0];
        if (current) choose(current.id, current.custom ? current.endpoint : "", current.needsKey, current.keySet, current.id === s.provider ? s.model : "");
      })
      .catch(() => {});
  }, [choose]);

  if (!status || !provider) return null;

  const saveKey = async () => {
    try {
      setKeyError("");
      setStatus(await AIService.SetKey(provider.id, key));
      setKey("");
      loadModels(provider.id);
    } catch (err) {
      setKeyError(`Couldn't save the key: ${errorMessage(err)}`);
    }
  };

  const removeKey = async () => {
    try {
      setKeyError("");
      setStatus(await AIService.ClearKey(provider.id));
      setModels([]);
      setError("");
    } catch (err) {
      setKeyError(`Couldn't remove the key: ${errorMessage(err)}`);
    }
  };

  const saveEndpoint = async (value: string) => {
    try {
      const next = await AIService.SetEndpoint(provider.id, value);
      setStatus(next);
      setEndpoint(value.trim().replace(/\/+$/, ""));
      if (!provider.needsKey || provider.keySet) loadModels(provider.id);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't save the endpoint", body: errorMessage(err) });
    }
  };

  const setPrivate = async (on: boolean) => {
    try {
      setStatus(await AIService.SetPrivate(provider.id, on));
    } catch (err) {
      toast({ tone: "error", title: "Couldn't change the setting", body: errorMessage(err) });
    }
  };

  const insecure = endpoint.startsWith("http://") && !provider.local;

  const savedModel = status.provider === provider.id ? status.model : "";
  const unsaved = !!chosen && chosen !== savedModel;
  const busy = phase !== "idle";

  const pickModel = (model: string) => {
    setChosen(model);
    setTested(null);
    setTestError("");
  };

  const save = async () => {
    setPhase("saving");
    try {
      setStatus(await AIService.Select(provider.id, chosen));
    } catch (err) {
      toast({ tone: "error", title: "Couldn't save the model", body: errorMessage(err) });
    } finally {
      setPhase("idle");
    }
  };

  // Sends a one-line prompt, then saves the model if it answered.
  const testAndSave = async () => {
    setTested(null);
    setTestError("");
    setPhase("testing");
    try {
      const result = await AIService.TestModel(provider.id, chosen);
      if (unsaved) {
        setPhase("saving");
        setStatus(await AIService.Select(provider.id, chosen));
      }
      setTested(result);
    } catch (err) {
      setTestError(errorMessage(err));
    } finally {
      setPhase("idle");
    }
  };

  // What the provider said when Relay listed its models: right under the
  // field that caused it (the key, or the endpoint when there's no key), so
  // it's seen without scrolling past the rest.
  const keyRow = provider.needsKey || provider.custom;
  const connecting = !provider.needsKey || provider.keySet;
  const connection = (
    <>
      {keyError && <span className="text-xs text-overdue">{keyError}</span>}
      {connecting && loading && (
        <span className="flex items-center gap-1.5 text-xs text-dim">
          <Loader2 className="size-3 animate-spin" />
          Connecting to {provider.name}…
        </span>
      )}
      {connecting && !loading && error && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-overdue">{error}</span>
          <Button variant="outline" size="md" onClick={() => loadModels(provider.id)}>
            Retry
          </Button>
        </div>
      )}
      {connecting && !loading && !error && models.length > 0 && (
        <span className="flex items-center gap-1 text-xs text-[#4ade80]">
          <Check className="size-3" />
          Connected: {models.length} {models.length === 1 ? "model" : "models"} available.
        </span>
      )}
    </>
  );

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="m-0 text-[15px] font-semibold text-strong">Model provider</h2>
        <p className="mt-1 text-[13px] text-dim">
          {status.ready ? `Using ${status.label}.` : "Optional. Relay only sends an article to a provider when you ask it to summarise."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Provider">
        {status.providers.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={p.id === picked}
            onClick={() => choose(p.id, p.custom ? p.endpoint : "", p.needsKey, p.keySet, p.id === status.provider ? status.model : "")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] text-muted-foreground hover:text-strong",
              p.id === picked && "border-border-strong bg-[#18181b] text-strong",
            )}
          >
            {p.name}
            {p.local && <span className="text-[11px] text-dim">local</span>}
            {p.private && <span className="text-[11px] text-dim">private</span>}
            {p.id === status.provider && status.ready && <Check className="size-3 text-[#4ade80]" />}
          </button>
        ))}
      </div>

      <div className={row}>
        <span className="pt-2.5 text-[13px] text-muted-foreground">Endpoint</span>
        <div className="flex flex-col gap-1.5">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveEndpoint(endpoint);
            }}
          >
            <Input
              aria-label="Endpoint"
              value={endpoint}
              placeholder={provider.defaultEndpoint}
              spellCheck={false}
              onChange={(e) => setEndpoint(e.target.value)}
              className="font-mono text-xs"
            />
            <Button type="submit" variant="outline" size="md" disabled={endpoint.replace(/\/+$/, "") === (provider.custom ? provider.endpoint : "")}>
              Save
            </Button>
            {provider.custom && (
              <Button type="button" variant="outline" size="md" onClick={() => saveEndpoint("")}>
                Reset
              </Button>
            )}
          </form>
          <span className="text-xs text-dim">
            Leave empty to use the default. {provider.keySet ? "Your API key is sent to this address." : ""}
          </span>
          {insecure && <span className="text-xs text-[#fbbf24]">This address is unencrypted, so articles{provider.keySet ? " and your API key" : ""} travel in plain text.</span>}
          {!keyRow && connection}
        </div>
      </div>

      {(provider.needsKey || provider.custom) && (
        <div className={row}>
          <span className="pt-2.5 text-[13px] text-muted-foreground">API key</span>
          <div className="flex flex-col gap-1.5">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (key.trim()) saveKey();
              }}
            >
              <SecretInput
                
                value={key}
                placeholder={provider.keySet ? "•••••••• (saved — type to replace)" : ""}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
              />
              <Button type="submit" size="md" disabled={!key.trim()}>
                Save
              </Button>
              {provider.keySet && (
                <Button type="button" variant="outline" size="md" onClick={removeKey}>
                  Remove
                </Button>
              )}
            </form>
            <span className="text-xs text-dim">Stored in the system keychain.</span>
            {connection}
          </div>
        </div>
      )}

      {provider.local ? (
        <p className="m-0 text-xs text-dim">Runs on this machine, so articles never leave it. {provider.name} needs to be running.</p>
      ) : (
        !provider.needsKey && <p className="m-0 text-xs text-dim">This address is on another machine, so articles you summarise are sent there.</p>
      )}

      <div className={row}>
        <span className="pt-2.5 text-[13px] text-muted-foreground">Private provider</span>
        <div className="flex flex-col gap-1.5">
          <label className="flex h-9 items-center gap-2.5 text-[13px] text-foreground">
            <Switch checked={provider.private} onCheckedChange={(on) => (on ? setConfirmPrivate(true) : setPrivate(false))} />
            This is a model provider I run or control
          </label>
          <span className="text-xs text-dim">
            {provider.private
              ? `${provider.endpoint} receives data from private projects too. Changing the endpoint turns this off.`
              : `For a self-hosted model behind an ${provider.name}-style endpoint, say. While off, Relay never sends this provider anything from a private project, even while it's unlocked.`}
            {provider.privateByDefault &&
              (provider.private
                ? ` On by default at ${provider.name}'s usual local address; turn it off if this is ${provider.name === "Ollama" ? "Ollama Cloud or " : ""}another service.`
                : provider.endpoint !== provider.defaultEndpoint
                  ? ` On by default only at ${provider.defaultEndpoint}.`
                  : "")}
          </span>
        </div>
      </div>

      {(!provider.needsKey || provider.keySet) && (
        <div className={row}>
          <span className="pt-2.5 text-[13px] text-muted-foreground">Model</span>
          <div className="flex flex-col gap-1.5">
            {!loading && (
              <div className="flex gap-2">
                <div className="min-w-0 grow">
                  <ModelPicker models={models} value={chosen} onChange={pickModel} />
                </div>
                <Button size="md" className="shrink-0" disabled={!chosen || busy} onClick={testAndSave}>
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  {phase === "testing" ? "Testing…" : phase === "saving" ? "Saving…" : unsaved ? "Test and save" : "Test"}
                </Button>
              </div>
            )}
            {testError ? (
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-overdue">
                {testError.replace(/\.?$/, ".")}
                {unsaved && (
                  <button className="text-[#93c5fd] hover:underline" onClick={save} disabled={busy}>
                    Save anyway
                  </button>
                )}
              </span>
            ) : tested ? (
              <span className="flex items-center gap-1 text-xs text-[#4ade80]">
                <Check className="size-3" />
                Works: replied “{tested.reply}” in {(tested.ms / 1000).toFixed(1)} s. Saved.
              </span>
            ) : (
              !loading && (
                <span className="text-xs text-dim">
                  {unsaved ? "Not saved yet. Relay sends a one-line test prompt, then saves the model." : savedModel ? "Saved. Used when you ask for a summary." : "Pick a model, then test it."}
                </span>
              )
            )}
          </div>
        </div>
      )}
      <Dialog open={confirmPrivate} onOpenChange={setConfirmPrivate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {provider.name} as a private provider?</DialogTitle>
            <DialogDescription>
              From now on, <span className="break-all font-mono text-xs text-foreground">{provider.endpoint}</span> receives data from private projects
              too: locked projects and modules, whenever you use AI on them.
            </DialogDescription>
          </DialogHeader>
          <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
            Only do this for a model you run or control, such as one on your own machine or network that only looks like an OpenAI endpoint. If the
            endpoint changes, Relay turns this off again.
          </p>
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={() => setConfirmPrivate(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="md"
              onClick={() => {
                setConfirmPrivate(false);
                setPrivate(true);
              }}
            >
              Mark as private
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
