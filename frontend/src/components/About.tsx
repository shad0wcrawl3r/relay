import { useEffect, useState } from "react";
import { Clipboard } from "@wailsio/runtime";
import { Check, Copy } from "lucide-react";
import { UpdateService, type BuildInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";

const date = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/** Settings → About: the version and how this copy was built. */
export function About() {
  const [b, setB] = useState<BuildInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    UpdateService.Build().then(setB, () => {});
  }, []);
  if (!b) return null;

  const rows: [string, string][] = [
    ["Version", b.dev ? `${b.display} (dev build of ${b.version})` : b.version],
    ["Build", b.dev ? "Development" : "Release"],
    ["Commit", b.commit ? `${b.commit}${b.dirty ? " with uncommitted changes" : ""}` : "Unknown"],
    ["Commit date", b.commitDate ? date(b.commitDate) : "Unknown"],
    ["Platform", b.platform],
    ["Go", b.go],
    ["Wails", b.wails || "Unknown"],
  ];

  const copy = async () => {
    await Clipboard.SetText(["Relay", ...rows.map(([k, v]) => `${k}: ${v}`)].join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="m-0 text-[15px] font-semibold text-strong">About Relay</h2>
        <p className="mt-1 text-[13px] text-dim">A desktop workbench for building in public.</p>
      </div>
      <dl className="m-0 grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 rounded-[10px] border border-column-border bg-column p-4 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-dim">{k}</dt>
            <dd className="m-0 select-text break-all font-mono text-[12.5px] text-[#e4e4e7]">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <Button variant="outline" size="md" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy build info"}
        </Button>
      </div>
    </section>
  );
}
