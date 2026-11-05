import { useState } from "react";
import { Browser, Clipboard } from "@wailsio/runtime";
import { Check, ChevronRight, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Scopes as they appear under "Scopes & Permissions" on the Plane app form.
const READ_SCOPES = [
  "profile",
  "workspaces.members",
  "projects",
  "projects.states",
  "projects.labels",
  "projects.modules",
  "projects.cycles",
  "projects.work_items",
  "projects.work_items.comments",
  "projects.work_items.activities",
];
const WRITE_SCOPES = ["projects.work_items", "projects.work_items.comments"];

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="mt-1.5 flex items-center gap-1.5">
      <code className="selectable min-w-0 flex-1 truncate rounded-md border border-border bg-[#0c0c0e] px-2 py-1 font-mono text-[11.5px] text-[#e4e4e7]">{value}</code>
      <Button
        variant="outline"
        size="icon"
        className="size-7 shrink-0"
        aria-label={`Copy ${label}`}
        onClick={() => {
          Clipboard.SetText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </Button>
    </span>
  );
}

function Scopes({ access, names }: { access: "read" | "write"; names: string[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {names.map((n) => (
        <code key={n} className="selectable rounded border border-[#2a2a30] px-1.5 py-px font-mono text-[11px] text-[#b4b4bc]">
          {n}:{access}
        </code>
      ))}
    </div>
  );
}

interface Props {
  redirectUri: string;
  appUrl: string;
  workspace: string;
  defaultOpen: boolean;
}

/** Plane's Integrations page, where the OAuth app lives; "" without a workspace. */
export const planeIntegrationsUrl = (appUrl: string, workspace: string) =>
  workspace ? `${appUrl.replace(/\/+$/, "")}/${workspace}/settings/integrations/` : "";

/** How to register Relay as an OAuth app in Plane. */
export function PlaneAppGuide({ redirectUri, appUrl, workspace, defaultOpen }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const integrations = planeIntegrationsUrl(appUrl, workspace);

  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: "Open Workspace settings → Integrations and click Build your own.",
      body: integrations ? (
        <Button variant="outline" size="sm" className="mt-1.5" onClick={() => Browser.OpenURL(integrations)}>
          <ExternalLink className="size-3" />
          Open Integrations in Plane
        </Button>
      ) : (
        <span className="mt-1 block text-dim">
          The page is at <code className="font-mono text-[11.5px]">{appUrl}/&lt;workspace&gt;/settings/integrations/</code>. Fill in the
          workspace slug below to get a direct link.
        </span>
      ),
    },
    { title: "App Name: anything, e.g. Relay.", body: null },
    {
      title: "Setup URL: Relay doesn't use it. If the form requires one, use the redirect URI.",
      body: <CopyValue value={redirectUri} label="setup URL" />,
    },
    {
      title: "Redirect URI: must match exactly (127.0.0.1, not localhost; no trailing slash).",
      body: <CopyValue value={redirectUri} label="redirect URI" />,
    },
    { title: "Webhook URL: leave empty. Relay polls Plane instead of receiving webhooks.", body: null },
    { title: "Leave Enable App Mentions off.", body: null },
    {
      title: "Under Scopes & Permissions, tick these:",
      body: (
        <>
          <Scopes access="read" names={READ_SCOPES} />
          <Scopes access="write" names={WRITE_SCOPES} />
          <span className="mt-1.5 block text-dim">Leave the Scopes field below empty: Relay then gets exactly what you tick.</span>
        </>
      ),
    },
    {
      title: "Save the app, then paste its Client ID and Client Secret below.",
      body: <span className="mt-1 block text-dim">Plane shows the secret only once. If you lose it, regenerate it on the app.</span>,
    },
    { title: "Click Save settings, then Connect Plane, and approve access in your browser.", body: null },
  ];

  return (
    <div className="rounded-[10px] border border-column-border bg-column">
      <button
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] text-strong"
      >
        <ChevronRight className={cn("size-3.5 text-dim transition-transform", open && "rotate-90")} />
        How to create the Plane app
        <span className="ml-auto text-xs text-dim">{steps.length} steps · about 2 minutes</span>
      </button>
      {open && (
        <div className="border-t border-column-border px-4 pb-4 pt-3">
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-[12.5px] leading-relaxed text-[#d4d4d8]">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#1c1c20] font-mono text-[10.5px] text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  {s.title}
                  {s.body}
                </div>
              </li>
            ))}
          </ol>
          <p className="mb-0 mt-4 border-t border-column-border pt-3 text-xs leading-relaxed text-dim">
            Plane apps are in beta. If connecting fails with <code className="font-mono">unauthorized_client</code> even though the steps above
            match, Plane is refusing user tokens for this app. Uninstall the app from the workspace, regenerate the secret and connect again,
            or contact support@plane.so.
          </p>
        </div>
      )}
    </div>
  );
}
