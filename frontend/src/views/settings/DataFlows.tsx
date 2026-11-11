import { Browser } from "@wailsio/runtime";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { REPO } from "@/lib/bugReport";

// Settings → Security & privacy: where each kind of data goes, in plain
// words. Keep it in step with docs/threat-model.md.

const FLOWS: { what: string; where: string }[] = [
  {
    what: "Tokens and API keys",
    where: "Your system keychain only. Never in the config file, never shown again after you save them.",
  },
  {
    what: "Posts, caches and backups",
    where: "On this machine, encrypted (AES-256-GCM) with a key kept in your keychain. A copied app folder can't be read elsewhere.",
  },
  {
    what: "Plane",
    where: "Relay reads your boards and writes back only the changes you make. Its offline copy is encrypted and read-only until the first live sync.",
  },
  {
    what: "Dev.to",
    where: "Articles you send arrive as drafts. Publishing and unpublishing happen only when you confirm.",
  },
  {
    what: "Buffer",
    where: "Posts you write or schedule. A promotion needs a live article, and Relay adds its link itself.",
  },
  {
    what: "AI providers",
    where: "Only what you ask them to draft. Content from private projects only goes to a provider you marked private, or Ollama and LM Studio on their default ports.",
  },
  {
    what: "Logs",
    where: "In memory, gone when Relay quits. They never contain article text, prompts, terminal output or private projects.",
  },
  {
    what: "Terminal",
    where: "Runs on this machine. Its connection only listens on 127.0.0.1 and needs a key made fresh at each launch.",
  },
];

const LINKS = [
  { label: "How Relay is secured", url: `${REPO}/blob/main/docs/threat-model.md` },
  { label: "Security policy", url: `${REPO}/blob/main/SECURITY.md` },
  { label: "Report a vulnerability", url: `${REPO}/security/advisories/new` },
];

export function DataFlows() {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-[#46a758]" />
        <h2 className="m-0 text-[15px] font-semibold text-strong">Where your data goes</h2>
      </div>
      <dl className="m-0 grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-2.5 rounded-[10px] border border-column-border bg-column p-4 text-[13px]">
        {FLOWS.map((f) => (
          <div key={f.what} className="contents">
            <dt className="text-muted-foreground">{f.what}</dt>
            <dd className="m-0 text-[#e4e4e7]">{f.where}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {LINKS.map((l) => (
          <button key={l.url} className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline" onClick={() => Browser.OpenURL(l.url)}>
            <ExternalLink className="size-3" />
            {l.label}
          </button>
        ))}
      </div>
    </section>
  );
}
