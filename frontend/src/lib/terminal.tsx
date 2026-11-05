import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Events } from "@wailsio/runtime";
import { normaliseSessions, TerminalService, type TermEndpoint, type TermInfo, type TermKeymap } from "./api";
import { errorMessage } from "./utils";
import { useToast } from "@/components/Toaster";
import * as L from "./layout";

// Sessions live in Go; this store only holds which tab and pane shows which
// session. It survives view switches because it sits above the router.

interface Saved {
  version: 1;
  active: string;
  tabs: L.Tab[];
  sessions: Record<string, { name: string; cwd: string }>;
}

export interface PaneHandle {
  send: (data: string) => void;
  focus: () => void;
}

interface TerminalStore {
  endpoint: TermEndpoint | null;
  sessions: TermInfo[];
  session: (id: string) => TermInfo | undefined;
  tabs: L.Tab[];
  active: L.Tab | undefined;
  ready: boolean;
  start: () => void;
  selectTab: (id: string) => void;
  newTab: () => Promise<void>;
  renameTab: (id: string, name: string) => void;
  split: (dir: L.Dir) => Promise<void>;
  focusPane: (paneId: string) => void;
  move: (m: L.Move) => void;
  toggleZoom: () => void;
  closePane: (paneId?: string) => void;
  detachPane: (paneId?: string) => void;
  attach: (sessionId: string) => void;
  restart: (paneId: string) => Promise<void>;
  newSession: () => Promise<void>;
  setSizes: (splitId: string, sizes: number[]) => void;
  register: (paneId: string, h: PaneHandle | null) => void;
  sendToFocused: (data: string) => void;
  keymap: TermKeymap | null;
  reloadKeymap: () => void;
  closeTab: (id?: string) => void;
  cycleTab: (step: 1 | -1) => void;
  selectTabIndex: (i: number) => void;
  breakPane: (paneId?: string) => void;
  movePane: (src: string, target: string, edge: L.Edge) => void;
  movePaneToTab: (src: string, tabId: string) => void;
  dragging: string | null;
  setDragging: (paneId: string | null) => void;
  /** Session for the quick terminal: the previous one of this kind while
   *  its shell lives, otherwise a new one in cwd. */
  quickSession: (kind: QuickKind, cwd: string) => Promise<string>;
  /** Shows a session in a new tab of the Terminal view. */
  openInTab: (sessionId: string) => void;
  /** Sessions currently owned by the quick terminal, by kind. */
  quickIds: Partial<Record<QuickKind, string>>;
}

export type QuickKind = "home" | "posts";

const Ctx = createContext<TerminalStore | null>(null);

export function useTerminal(): TerminalStore {
  const s = useContext(Ctx);
  if (!s) throw new Error("useTerminal outside TerminalProvider");
  return s;
}

const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || "/";

export function TerminalProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [endpoint, setEndpoint] = useState<TermEndpoint | null>(null);
  const [sessions, setSessions] = useState<TermInfo[]>([]);
  const [tabs, setTabs] = useState<L.Tab[]>([]);
  const [activeId, setActiveId] = useState("");
  const [ready, setReady] = useState(false);
  const [keymap, setKeymap] = useState<TermKeymap | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const started = useRef(false);
  const handles = useRef(new Map<string, PaneHandle>());
  const [quickIds, setQuickIds] = useState<Partial<Record<QuickKind, string>>>({});
  const quick = useRef(quickIds);
  quick.current = quickIds;
  // Tabs opened before the Terminal view has loaded its layout.
  const pendingTabs = useRef<L.Tab[]>([]);
  const readyRef = useRef(false);
  readyRef.current = ready;
  // Latest values for callbacks that must not go stale.
  const live = useRef({ tabs, activeId, sessions, endpoint });
  live.current = { tabs, activeId, sessions, endpoint };

  useEffect(() => {
    const off = Events.On("term:sessions", (ev) => setSessions(normaliseSessions(ev.data)));
    TerminalService.List().then(setSessions).catch(() => {});
    TerminalService.Endpoint().then(setEndpoint).catch(() => {});
    return () => off();
  }, []);

  const reloadKeymap = useCallback(() => {
    TerminalService.Keymap()
      .then((k) => {
        setKeymap(k);
        if (k.error) toast({ tone: "error", title: "Couldn't read your tmux config", body: k.error });
      })
      .catch(() => {});
  }, [toast]);
  useEffect(() => reloadKeymap(), [reloadKeymap]);

  const fail = useCallback((title: string, err: unknown) => toast({ tone: "error", title, body: errorMessage(err) }), [toast]);

  const nameFor = useCallback((cwd: string, home: string) => (!cwd || cwd === home ? "" : base(cwd)), []);

  // New sessions start in the focused pane's folder.
  const create = useCallback(
    async (cwd?: string) => {
      const { endpoint } = live.current;
      const home = endpoint?.home ?? "";
      const info = await TerminalService.Create({ cwd: cwd ?? "", name: nameFor(cwd ?? home, home) });
      setSessions((s) => (s.some((x) => x.id === info.id) ? s : [...s, info]));
      return info;
    },
    [nameFor],
  );

  const focusedCwd = useCallback(() => {
    const { tabs, activeId, sessions } = live.current;
    const t = tabs.find((x) => x.id === activeId);
    const p = t && L.findPane(t.root, t.focus);
    return sessions.find((s) => s.id === p?.sessionId)?.cwd;
  }, []);

  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const [raw, current] = await Promise.all([TerminalService.LoadLayout(), TerminalService.List()]);
        const byId = new Set(current.map((s) => s.id));
        let saved: Saved | null = null;
        try {
          saved = raw ? (JSON.parse(raw) as Saved) : null;
        } catch {
          saved = null;
        }
        let restored: L.Tab[] = [];
        if (saved?.version === 1 && saved.tabs.length) {
          // Sessions end when Relay quits; respawn each pane's shell by name
          // and folder.
          for (const t of saved.tabs) {
            let root = t.root;
            for (const p of L.panes(t.root)) {
              if (byId.has(p.sessionId)) continue;
              const meta = saved.sessions[p.sessionId];
              const info = await TerminalService.Create({ name: meta?.name ?? "", cwd: meta?.cwd ?? "" });
              root = L.setSession(root, p.id, info.id);
            }
            restored.push({ ...t, root, zoom: undefined });
          }
        }
        // A tab opened from the quick terminal counts as the first tab.
        if (!restored.length && !pendingTabs.current.length) {
          const info = await TerminalService.Create({});
          const p = L.pane(info.id);
          restored = [{ id: L.uid(), name: info.name, root: p, focus: p.id }];
        }
        restored.push(...pendingTabs.current);
        const opened = pendingTabs.current[pendingTabs.current.length - 1]?.id;
        pendingTabs.current = [];
        setTabs(restored);
        setActiveId(opened ?? restored.find((t) => t.id === saved?.active)?.id ?? restored[0].id);
        setSessions(await TerminalService.List());
        setReady(true);
      } catch (err) {
        started.current = false;
        fail("Couldn't start the terminal", err);
      }
    })();
  }, [fail]);

  // Persist layout (names and folders only, never output).
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      const meta: Saved["sessions"] = {};
      for (const tab of tabs)
        for (const p of L.panes(tab.root)) {
          const s = sessions.find((x) => x.id === p.sessionId);
          if (s) meta[p.sessionId] = { name: s.name, cwd: s.cwd };
        }
      const saved: Saved = { version: 1, active: activeId, tabs, sessions: meta };
      TerminalService.SaveLayout(JSON.stringify(saved)).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [ready, tabs, activeId, sessions]);

  const updateActive = useCallback((fn: (t: L.Tab) => L.Tab | null) => {
    setTabs((all) => {
      const id = live.current.activeId;
      const next: L.Tab[] = [];
      for (const t of all) {
        if (t.id !== id) next.push(t);
        else {
          const u = fn(t);
          if (u) next.push(u);
        }
      }
      return next;
    });
  }, []);

  // Closing the active tab's last pane: fall back to the last tab.
  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.id === activeId)) setActiveId(tabs[tabs.length - 1].id);
  }, [tabs, activeId]);

  const focusPane = useCallback(
    (paneId: string) => updateActive((t) => (t.focus === paneId ? t : { ...t, focus: paneId, zoom: t.zoom ? paneId : undefined })),
    [updateActive],
  );

  const split = useCallback(
    async (dir: L.Dir) => {
      try {
        const info = await create(focusedCwd());
        const added = L.pane(info.id);
        updateActive((t) => ({ ...t, root: L.split(t.root, t.focus, dir, added), focus: added.id, zoom: undefined }));
      } catch (err) {
        fail("Couldn't open a new pane", err);
      }
    },
    [create, focusedCwd, updateActive, fail],
  );

  const newTab = useCallback(async () => {
    try {
      const info = await create(focusedCwd());
      const p = L.pane(info.id);
      const tab: L.Tab = { id: L.uid(), name: info.name, root: p, focus: p.id };
      setTabs((all) => [...all, tab]);
      setActiveId(tab.id);
    } catch (err) {
      fail("Couldn't open a new tab", err);
    }
  }, [create, focusedCwd, fail]);

  const newSession = useCallback(async () => {
    try {
      await create(focusedCwd());
    } catch (err) {
      fail("Couldn't start a session", err);
    }
  }, [create, focusedCwd, fail]);

  const paneOrFocus = (paneId?: string) => {
    const t = live.current.tabs.find((x) => x.id === live.current.activeId);
    return t ? { tab: t, pane: L.findPane(t.root, paneId ?? t.focus) } : undefined;
  };

  // Removing the last pane of the last tab leaves an empty workspace; the
  // view offers to start a new session.
  const dropPane = useCallback(
    (paneId: string) =>
      updateActive((t) => {
        const root = L.remove(t.root, paneId);
        if (!root) return null;
        const left = L.panes(root);
        const focus = left.some((p) => p.id === t.focus) ? t.focus : left[left.length - 1].id;
        return { ...t, root, focus, zoom: t.zoom === paneId ? undefined : t.zoom };
      }),
    [updateActive],
  );

  const closePane = useCallback(
    (paneId?: string) => {
      const found = paneOrFocus(paneId);
      if (!found?.pane) return;
      TerminalService.Kill(found.pane.sessionId).catch(() => {});
      dropPane(found.pane.id);
    },
    [dropPane],
  );

  const detachPane = useCallback(
    (paneId?: string) => {
      const found = paneOrFocus(paneId);
      if (found?.pane) dropPane(found.pane.id);
    },
    [dropPane],
  );

  const attach = useCallback(
    (sessionId: string) => {
      const { tabs, activeId } = live.current;
      const owner = tabs.find((t) => L.panes(t.root).some((p) => p.sessionId === sessionId));
      if (owner) {
        const p = L.panes(owner.root).find((x) => x.sessionId === sessionId)!;
        setActiveId(owner.id);
        setTabs((all) => all.map((t) => (t.id === owner.id ? { ...t, focus: p.id, zoom: t.zoom ? p.id : undefined } : t)));
        return;
      }
      const active = tabs.find((t) => t.id === activeId);
      if (!active) {
        const p = L.pane(sessionId);
        const s = live.current.sessions.find((x) => x.id === sessionId);
        const tab: L.Tab = { id: L.uid(), name: s?.name ?? "shell", root: p, focus: p.id };
        setTabs((all) => [...all, tab]);
        setActiveId(tab.id);
        return;
      }
      // A background session swaps into the focused pane; the one it
      // replaces goes to the background, so nothing is lost.
      updateActive((t) => ({ ...t, root: L.setSession(t.root, t.focus, sessionId) }));
    },
    [updateActive],
  );

  const restart = useCallback(
    async (paneId: string) => {
      const found = paneOrFocus(paneId);
      if (!found?.pane) return;
      const old = live.current.sessions.find((s) => s.id === found.pane!.sessionId);
      try {
        const info = await TerminalService.Create({ name: old?.name ?? "", cwd: old?.cwd ?? "" });
        updateActive((t) => ({ ...t, root: L.setSession(t.root, paneId, info.id) }));
        if (old) TerminalService.Kill(old.id).catch(() => {});
      } catch (err) {
        fail("Couldn't restart the session", err);
      }
    },
    [updateActive, fail],
  );

  const move = useCallback(
    (m: L.Move) =>
      updateActive((t) => {
        if (t.zoom) return t;
        const next = L.neighbor(t.root, t.focus, m);
        return next ? { ...t, focus: next } : t;
      }),
    [updateActive],
  );

  const toggleZoom = useCallback(() => updateActive((t) => ({ ...t, zoom: t.zoom ? undefined : t.focus })), [updateActive]);

  const setSizes = useCallback(
    (splitId: string, sizes: number[]) =>
      updateActive((t) => {
        const root = L.setSizes(t.root, splitId, sizes);
        // react-resizable-panels reports the layout on every mount; skip no-ops.
        return JSON.stringify(root) === JSON.stringify(t.root) ? t : { ...t, root };
      }),
    [updateActive],
  );

  const renameTab = useCallback((id: string, name: string) => {
    const n = name.trim();
    if (n) setTabs((all) => all.map((t) => (t.id === id ? { ...t, name: n } : t)));
  }, []);

  const register = useCallback((paneId: string, h: PaneHandle | null) => {
    if (h) handles.current.set(paneId, h);
    else handles.current.delete(paneId);
  }, []);

  const sendToFocused = useCallback((data: string) => {
    const t = live.current.tabs.find((x) => x.id === live.current.activeId);
    if (t) handles.current.get(t.focus)?.send(data);
  }, []);

  // Keep keyboard focus on the focused pane.
  const active = tabs.find((t) => t.id === activeId);
  useEffect(() => {
    if (active) handles.current.get(active.focus)?.focus();
  }, [active?.id, active?.focus, active?.zoom]);

  // A shell that exits (`exit`, ⌃D) closes its pane, and a tab whose last
  // pane exits closes with it, like a terminal app's window.
  useEffect(() => {
    const exited = new Set(sessions.filter((s) => s.status === "exited").map((s) => s.id));
    if (!exited.size) return;
    const dead: string[] = [];
    const next = tabs.flatMap((t) => {
      let root: L.LayoutNode | null = t.root;
      for (const p of L.panes(t.root)) {
        if (!root || !exited.has(p.sessionId)) continue;
        root = L.remove(root, p.id);
        dead.push(p.sessionId);
      }
      if (root === t.root) return [t];
      if (!root) return [];
      const left = L.panes(root);
      return [{ ...t, root, focus: left.some((p) => p.id === t.focus) ? t.focus : left[left.length - 1].id, zoom: undefined }];
    });
    if (!dead.length) return;
    setTabs(next);
    for (const id of dead) TerminalService.Kill(id).catch(() => {});
  }, [sessions, tabs]);

  const closeTab = useCallback((id?: string) => {
    const { tabs, activeId } = live.current;
    const tab = tabs.find((t) => t.id === (id ?? activeId));
    if (!tab) return;
    for (const p of L.panes(tab.root)) TerminalService.Kill(p.sessionId).catch(() => {});
    setTabs((all) => all.filter((t) => t.id !== tab.id));
  }, []);

  const cycleTab = useCallback((step: 1 | -1) => {
    const { tabs, activeId } = live.current;
    if (tabs.length < 2) return;
    const i = tabs.findIndex((t) => t.id === activeId);
    setActiveId(tabs[(i + step + tabs.length) % tabs.length].id);
  }, []);

  const selectTabIndex = useCallback((i: number) => {
    const t = live.current.tabs[i];
    if (t) setActiveId(t.id);
  }, []);

  // tmux break-pane: the pane leaves its tab for a new one of its own.
  const breakPane = useCallback(
    (paneId?: string) => {
      const found = paneOrFocus(paneId);
      if (!found?.pane || L.panes(found.tab.root).length < 2) return;
      const p = found.pane;
      dropPane(p.id);
      const s = live.current.sessions.find((x) => x.id === p.sessionId);
      const tab: L.Tab = { id: L.uid(), name: s?.name || "shell", root: p, focus: p.id };
      setTabs((all) => [...all, tab]);
      setActiveId(tab.id);
    },
    [dropPane],
  );

  const movePane = useCallback(
    (src: string, target: string, edge: L.Edge) =>
      updateActive((t) => {
        const root = L.movePane(t.root, src, target, edge);
        return root === t.root ? t : { ...t, root, focus: src, zoom: undefined };
      }),
    [updateActive],
  );

  const movePaneToTab = useCallback(
    (src: string, tabId: string) => {
      const { tabs, activeId } = live.current;
      const from = tabs.find((t) => t.id === activeId);
      const to = tabs.find((t) => t.id === tabId);
      const p = from && L.findPane(from.root, src);
      if (!from || !to || !p || from.id === to.id) return;
      setTabs((all) =>
        all.flatMap((t) => {
          if (t.id === from.id) {
            const root = L.remove(t.root, src);
            if (!root) return [];
            const left = L.panes(root);
            return [{ ...t, root, focus: left.some((x) => x.id === t.focus) ? t.focus : left[0].id, zoom: undefined }];
          }
          if (t.id === to.id) return [{ ...t, root: L.split(t.root, t.focus, "h", p), focus: p.id, zoom: undefined }];
          return [t];
        }),
      );
      setActiveId(to.id);
    },
    [],
  );

  const quickSession = useCallback(async (kind: QuickKind, cwd: string) => {
    const prev = quick.current[kind];
    const live = await TerminalService.List();
    setSessions(live);
    if (prev && live.some((s) => s.id === prev && s.status !== "exited")) return prev;
    // The old shell is dead; don't leave it in the sessions list.
    if (prev) TerminalService.Kill(prev).catch(() => {});
    const info = await TerminalService.Create({ cwd, name: kind === "posts" ? "posts" : "quick" });
    quick.current = { ...quick.current, [kind]: info.id };
    setQuickIds(quick.current);
    setSessions((s) => (s.some((x) => x.id === info.id) ? s : [...s, info]));
    return info.id;
  }, []);

  const openInTab = useCallback(
    (sessionId: string) => {
      // It belongs to the Terminal view now; the quick terminal starts afresh.
      const kept = Object.fromEntries(Object.entries(quick.current).filter(([, id]) => id !== sessionId));
      if (Object.keys(kept).length !== Object.keys(quick.current).length) {
        quick.current = kept;
        setQuickIds(kept);
      }
      const owner = live.current.tabs.find((t) => L.panes(t.root).some((p) => p.sessionId === sessionId));
      if (owner) return attach(sessionId);
      const p = L.pane(sessionId);
      const s = live.current.sessions.find((x) => x.id === sessionId);
      const tab: L.Tab = { id: L.uid(), name: s?.name || "shell", root: p, focus: p.id };
      // Until the layout has loaded, start() would overwrite it; queue it.
      if (!readyRef.current) {
        pendingTabs.current.push(tab);
        return;
      }
      setTabs((all) => [...all, tab]);
      setActiveId(tab.id);
    },
    [attach],
  );

  const session = useCallback((id: string) => sessions.find((s) => s.id === id), [sessions]);

  const value = useMemo<TerminalStore>(
    () => ({
      endpoint,
      sessions,
      session,
      tabs,
      active,
      ready,
      start,
      selectTab: setActiveId,
      newTab,
      renameTab,
      split,
      focusPane,
      move,
      toggleZoom,
      closePane,
      detachPane,
      attach,
      restart,
      newSession,
      setSizes,
      register,
      sendToFocused,
      keymap,
      reloadKeymap,
      closeTab,
      cycleTab,
      selectTabIndex,
      breakPane,
      movePane,
      movePaneToTab,
      dragging,
      setDragging,
      quickSession,
      openInTab,
      quickIds,
    }),
    [
      endpoint,
      sessions,
      session,
      tabs,
      active,
      ready,
      start,
      newTab,
      renameTab,
      split,
      focusPane,
      move,
      toggleZoom,
      closePane,
      detachPane,
      attach,
      restart,
      newSession,
      setSizes,
      register,
      sendToFocused,
      keymap,
      reloadKeymap,
      closeTab,
      cycleTab,
      selectTabIndex,
      breakPane,
      movePane,
      movePaneToTab,
      dragging,
      quickSession,
      openInTab,
      quickIds,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
