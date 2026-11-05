import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { AIService, type AIStatus } from "@/lib/api";
import { cn, errorMessage } from "@/lib/utils";
import { ModelPicker } from "@/components/ModelPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
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
  const [endpoint, setEndpoint] = useState("");

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
    (id: string, custom: string, needsKey: boolean, keySet: boolean) => {
      setPicked(id);
      setKey("");
      setEndpoint(custom);
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
        if (current) choose(current.id, current.custom ? current.endpoint : "", current.needsKey, current.keySet);
      })
      .catch(() => {});
  }, [choose]);

  if (!status || !provider) return null;

  const saveKey = async () => {
    try {
      setStatus(await AIService.SetKey(provider.id, key));
      setKey("");
      loadModels(provider.id);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't save the key", body: errorMessage(err) });
    }
  };

  const removeKey = async () => {
    try {
      setStatus(await AIService.ClearKey(provider.id));
      setModels([]);
      setError("");
    } catch (err) {
      toast({ tone: "error", title: "Couldn't remove the key", body: errorMessage(err) });
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

  const insecure = endpoint.startsWith("http://") && !provider.local;

  const select = async (model: string) => {
    try {
      setStatus(await AIService.Select(provider.id, model));
    } catch (err) {
      toast({ tone: "error", title: "Couldn't save the model", body: errorMessage(err) });
    }
  };

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
            onClick={() => choose(p.id, p.custom ? p.endpoint : "", p.needsKey, p.keySet)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] text-muted-foreground hover:text-strong",
              p.id === picked && "border-border-strong bg-[#18181b] text-strong",
            )}
          >
            {p.name}
            {p.local && <span className="text-[11px] text-dim">local</span>}
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
          </div>
        </div>
      )}

      {provider.local ? (
        <p className="m-0 text-xs text-dim">Runs on this machine, so articles never leave it. {provider.name} needs to be running.</p>
      ) : (
        !provider.needsKey && <p className="m-0 text-xs text-dim">This address is on another machine, so articles you summarise are sent there.</p>
      )}

      {(!provider.needsKey || provider.keySet) && (
        <div className={row}>
          <span className="pt-2.5 text-[13px] text-muted-foreground">Model</span>
          <div className="flex flex-col gap-1.5">
            {loading ? (
              <span className="flex h-9 items-center gap-1.5 text-xs text-dim">
                <Loader2 className="size-3 animate-spin" />
                Connecting…
              </span>
            ) : (
              <ModelPicker models={models} value={status.provider === provider.id ? status.model : ""} onChange={select} />
            )}
            {error && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-overdue">{error}</span>
                <Button variant="outline" size="md" onClick={() => loadModels(provider.id)}>
                  Retry
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
