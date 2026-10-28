import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Events } from "@wailsio/runtime";
import { normaliseSnapshot, PlaneService, type Item, type ItemPatch, type Project, type Snapshot } from "./api";
import { errorMessage } from "./utils";
import { useToast } from "@/components/Toaster";

interface PlaneStore {
  snapshot: Snapshot | null;
  syncing: boolean;
  projects: Project[];
  project: (id: string) => Project | undefined;
  syncNow: () => Promise<void>;
  update: (item: Item, patch: Partial<ItemPatch>, okMessage?: string) => Promise<boolean>;
  create: (projectId: string, name: string, stateId?: string) => Promise<Item | null>;
  comment: (item: Item, html: string) => Promise<boolean>;
}

const Ctx = createContext<PlaneStore | null>(null);

export function usePlane(): PlaneStore {
  const s = useContext(Ctx);
  if (!s) throw new Error("usePlane outside PlaneProvider");
  return s;
}

function applyPatch(it: Item, p: Partial<ItemPatch>): Item {
  return {
    ...it,
    name: p.name ?? it.name,
    stateId: p.stateId ?? it.stateId,
    priority: p.priority ?? it.priority,
    labelIds: p.labelIds ?? it.labelIds,
    targetDate: p.targetDate ?? it.targetDate,
  };
}

export function PlaneProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Optimistic edits survive a sync that raced the write; cleared once Plane agrees.
  const pending = useRef(new Map<string, Partial<ItemPatch>>());
  const pendingAt = useRef(new Map<string, number>());
  const lastError = useRef("");

  const receive = useCallback(
    (s: Snapshot) => {
      if (s.error && s.error !== lastError.current) {
        toast({ tone: "error", title: "Plane sync failed", body: s.error });
      }
      lastError.current = s.error;
      for (const [id, patch] of pending.current) {
        const it = s.projects.flatMap((p) => p.items).find((i) => i.id === id);
        const agrees = it && Object.entries(patch).every(([k, v]) => JSON.stringify((it as any)[k]) === JSON.stringify(v));
        // Plane may normalise a value (e.g. label order); don't mask it forever.
        if (!it || agrees || Date.now() - (pendingAt.current.get(id) ?? 0) > 30000) {
          pending.current.delete(id);
          pendingAt.current.delete(id);
        }
      }
      setSnapshot(s);
    },
    [toast],
  );

  useEffect(() => {
    PlaneService.Snapshot().then(receive).catch(() => {});
    const off = Events.On("plane:snapshot", (ev) => {
      setSyncing(false);
      receive(normaliseSnapshot(ev.data));
    });
    return () => off();
  }, [receive]);

  const projects = useMemo(() => {
    const ps = snapshot?.projects ?? [];
    if (pending.current.size === 0) return ps;
    return ps.map((p) => ({
      ...p,
      items: p.items.map((it) => (pending.current.has(it.id) ? applyPatch(it, pending.current.get(it.id)!) : it)),
    }));
  }, [snapshot]);

  const project = useCallback((id: string) => projects.find((p) => p.id === id), [projects]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      receive(await PlaneService.SyncNow());
    } finally {
      setSyncing(false);
    }
  }, [receive]);

  const update = useCallback(
    async (item: Item, patch: Partial<ItemPatch>, okMessage?: string) => {
      pending.current.set(item.id, { ...pending.current.get(item.id), ...patch });
      pendingAt.current.set(item.id, Date.now());
      setSnapshot((s) => (s ? { ...s } : s));
      try {
        await PlaneService.Update(item.projectId, item.id, patch);
        if (okMessage) toast({ tone: "success", title: okMessage });
        return true;
      } catch (err) {
        pending.current.delete(item.id);
        setSnapshot((s) => (s ? { ...s } : s));
        toast({ tone: "error", title: `Couldn't update ${item.key}`, body: errorMessage(err) });
        return false;
      }
    },
    [toast],
  );

  const create = useCallback(
    async (projectId: string, name: string, stateId?: string) => {
      try {
        const it = await PlaneService.Create({ projectId, name, stateId: stateId ?? "", priority: "", descriptionHtml: "" });
        setSnapshot((s) =>
          s ? { ...s, projects: s.projects.map((p) => (p.id === projectId ? { ...p, items: [...p.items, it] } : p)) } : s,
        );
        toast({ tone: "success", title: `Created ${it.key}` });
        return it;
      } catch (err) {
        toast({ tone: "error", title: "Couldn't create item", body: errorMessage(err) });
        return null;
      }
    },
    [toast],
  );

  const comment = useCallback(
    async (item: Item, html: string) => {
      try {
        await PlaneService.Comment(item.projectId, item.id, html);
        return true;
      } catch (err) {
        toast({ tone: "error", title: "Couldn't post comment", body: errorMessage(err) });
        return false;
      }
    },
    [toast],
  );

  const value = useMemo(
    () => ({ snapshot, syncing, projects, project, syncNow, update, create, comment }),
    [snapshot, syncing, projects, project, syncNow, update, create, comment],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
