import { useEffect, useState } from "react";
import { BufferService, PlaneService, type BufferOrganization, type BufferPlanning } from "@/lib/api";
import { usePlane } from "@/lib/store";
import { useToast } from "@/components/Toaster";
import { errorMessage } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

/**
 * Turns on the Buffer planning board: Buffer content items shown as a board,
 * with or without Plane. Columns before posting are Buffer tags Relay adds.
 */
export function BufferPlanningRow() {
  const toast = useToast();
  const { snapshot } = usePlane();
  const [setting, setSetting] = useState<BufferPlanning | null>(null);
  const [orgs, setOrgs] = useState<BufferOrganization[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    PlaneService.BufferPlanning().then(setSetting);
    BufferService.Organizations().then(setOrgs).catch(() => setOrgs([]));
  }, []);

  const save = async (enabled: boolean, orgId: string) => {
    setBusy(true);
    try {
      setSetting(await PlaneService.SetBufferPlanning(enabled, orgId));
    } catch (err) {
      toast({ tone: "error", title: "Couldn't change planning in Buffer", body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!setting) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-column-border bg-column px-4 py-3">
      <label className="flex items-center gap-2.5 text-[13px] text-strong">
        <Switch checked={setting.enabled} disabled={busy} onCheckedChange={(v) => save(v, setting.orgId)} />
        Plan in Buffer
        <span className="rounded bg-[#2a2113] px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-[#fcd34d]">Experimental</span>
      </label>
      <p className="m-0 text-xs text-dim">
        Adds a board of your Buffer content items, so you can plan without Plane. Idea, Todo, In Progress and Ready are Buffer tags Relay
        adds (named “Relay: …”); cards with posts in Buffer move to Scheduled and Published on their own. Buffer marks this part of its API
        experimental, so it may change.
      </p>
      {setting.enabled && orgs.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Organization
          <select
            value={setting.orgId || orgs[0]?.id}
            disabled={busy}
            onChange={(e) => save(true, e.target.value)}
            className="h-7 rounded-md border border-border bg-[#121215] px-2 text-xs text-strong outline-none"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {setting.enabled && snapshot?.bufferPlanError && <p className="m-0 text-xs text-[#fca5a5]">{snapshot.bufferPlanError}</p>}
    </div>
  );
}
