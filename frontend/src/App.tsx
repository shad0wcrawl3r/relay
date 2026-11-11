import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import { loadPref, savePref } from "@/lib/prefs";
import { usePlane } from "@/lib/store";
import { boardsOn, stateById } from "@/lib/plane";
import { Sidebar } from "@/components/Sidebar";
import { CachedBanner } from "@/components/CachedBanner";
import { LockScreen } from "@/components/LockScreen";
import { Capture } from "@/components/Capture";
import { ItemDrawer } from "@/components/ItemDrawer";
import { Attention } from "@/views/Attention";
import { Board, type BoardHandle } from "@/views/Board";
import { Editor } from "@/views/editor/Editor";
import { Settings, type SettingsTab } from "@/views/Settings";
import { Buffer, type BufferFocus } from "@/views/buffer/Buffer";
import { Terminal } from "@/views/terminal/Terminal";
import { Timeline } from "@/views/timeline/Timeline";
import { QuickTerminal } from "@/views/terminal/QuickTerminal";
import { UpdateNotifier } from "@/components/Updates";
import { FailedPostNotifier } from "@/components/FailedPosts";
import { WhatsNewDialog } from "@/components/Changelog";
import { ShortcutSheet } from "@/components/ShortcutSheet";
import { GO_KEYS } from "@/lib/shortcuts";

export type Route = { name: "attention" } | { name: "project"; projectId: string } | { name: "editor"; postId?: string } | { name: "buffer"; focus?: BufferFocus } | { name: "timeline"; day?: string } | { name: "terminal" } | { name: "settings"; tab?: SettingsTab };

export interface OpenItem {
  projectId: string;
  itemId: string;
  focusComposer?: boolean;
}

// The view to reopen at launch. Only names and IDs; a locked project still
// opens on its lock screen.
const ROUTE_KEY = "relay.route";
const ROUTE_NAMES = ["attention", "project", "editor", "buffer", "timeline", "terminal", "settings"];
function savedRoute(): Route {
  const r = loadPref<{ name?: string; projectId?: string; postId?: string; tab?: string }>(ROUTE_KEY, {});
  if (!r.name || !ROUTE_NAMES.includes(r.name)) return { name: "attention" };
  if (r.name === "project") return r.projectId ? { name: "project", projectId: r.projectId } : { name: "attention" };
  if (r.name === "settings") return { name: "settings", tab: r.tab as SettingsTab | undefined };
  return { name: r.name } as Route;
}
function saveRoute(r: Route) {
  savePref(ROUTE_KEY, { name: r.name, projectId: r.name === "project" ? r.projectId : undefined, tab: r.name === "settings" ? r.tab : undefined });
}

// The sidebar's width, chosen with ⌘\: one choice for the editor and the
// terminal (icons only by default), one for every other view.
const SIDEBAR_KEY = "relay.sidebar";
type SidebarPref = { focusRail: boolean; otherRail: boolean };
const railView = (r: Route) => r.name === "editor" || r.name === "terminal";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export default function App() {
  const { projects, project, syncNow, snapshot } = usePlane();
  const [route, setRoute] = useState<Route>(savedRoute);
  useEffect(() => saveRoute(route), [route]);
  const [sidebar, setSidebar] = useState<SidebarPref>(() => loadPref(SIDEBAR_KEY, { focusRail: true, otherRail: false }));
  const rail = railView(route) ? sidebar.focusRail : sidebar.otherRail;
  const toggleSidebar = useCallback(() => {
    setSidebar((s) => {
      const next = railView(route) ? { ...s, focusRail: !s.focusRail } : { ...s, otherRail: !s.otherRail };
      savePref(SIDEBAR_KEY, next);
      return next;
    });
  }, [route]);
  const [drawer, setDrawer] = useState<OpenItem | null>(null);
  const [capture, setCapture] = useState(false);
  const [quick, setQuick] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const board = useRef<BoardHandle>(null);
  const pendingG = useRef(0);

  const go = useCallback((r: Route) => {
    setRoute(r);
    setDrawer(null);
    // The Terminal view is the full version of the quick terminal.
    if (r.name === "terminal") setQuick(false);
  }, []);

  // The setup guide's last step brings this window forward on a view.
  useEffect(
    () =>
      Events.On("guide:show", (ev) => {
        const view = ev.data as string;
        if (view === "editor" || view === "buffer" || view === "timeline" || view === "attention" || view === "terminal" || view === "settings") go({ name: view });
      }),
    [go],
  );

  // The tray's "About Relay…" opens Settings → About.
  useEffect(
    () =>
      Events.On("app:navigate", (ev) => {
        const to = ev.data as { name?: string; tab?: string };
        if (to?.name === "settings") go({ name: "settings", tab: to.tab as SettingsTab | undefined });
      }),
    [go],
  );

  // ⌘/ or ⌃/ toggles the quick terminal anywhere but the Terminal view.
  // Captured so it works while the quick terminal itself has focus (xterm
  // would otherwise take ⌃/ as a keystroke).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || (e.code !== "Slash" && e.key !== "/")) return;
      if (route.name === "terminal") return;
      e.preventDefault();
      e.stopPropagation();
      setQuick((v) => !v);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [route.name]);

  const current = route.name === "project" ? project(route.projectId) : undefined;
  const drawerProject = drawer ? project(drawer.projectId) : undefined;
  // Relocking hides the item; don't leave its drawer open.
  useEffect(() => {
    if (drawer && drawerProject && !drawerProject.items.some((it) => it.id === drawer.itemId)) setDrawer(null);
  }, [drawer, drawerProject]);

  // Plane is optional. Without it there's no Attention or boards, so open on
  // the editor, and leave Plane views if it's disconnected later.
  const planeOn = boardsOn(snapshot);
  useEffect(() => {
    if (snapshot && !planeOn && (route.name === "attention" || route.name === "project")) setRoute({ name: "editor" });
  }, [snapshot, planeOn, route.name]);

  // If a project disappears (disconnect, permissions), fall back home.
  useEffect(() => {
    if (route.name === "project" && projects.length && !current) setRoute({ name: "attention" });
  }, [route, projects, current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "k") {
        e.preventDefault();
        setCapture((v) => !v);
        return;
      }
      if (mod && k === "r") {
        e.preventDefault();
        if (planeOn) syncNow();
        return;
      }
      if (mod && (e.key === "?" || (e.shiftKey && e.code === "Slash"))) {
        e.preventDefault();
        setShortcuts((v) => !v);
        return;
      }
      if (mod && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (mod && k === ",") {
        e.preventDefault();
        go({ name: "settings" });
        return;
      }
      if (mod && k === "f" && route.name === "project") {
        e.preventDefault();
        board.current?.focusSearch();
        return;
      }
      if (mod || e.altKey || isTyping(e.target) || capture || document.querySelector("[role=dialog]")) return;
      if (k === "g") {
        pendingG.current = Date.now();
        return;
      }
      if (k === "a" && planeOn && Date.now() - pendingG.current < 1000) {
        go({ name: "attention" });
        return;
      }
      if (/^[1-9]$/.test(k) && projects[Number(k) - 1]) {
        go({ name: "project", projectId: projects[Number(k) - 1].id });
        return;
      }
      if (GO_KEYS[k]) go(GO_KEYS[k].route);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [route, projects, capture, go, syncNow, planeOn, toggleSidebar]);

  // Prev/next in the drawer follows board order: states in sequence.
  const siblings = useMemo(() => {
    if (!drawerProject) return [];
    const order = new Map(drawerProject.states.map((s, i) => [s.id, i]));
    const byState = stateById(drawerProject);
    return [...drawerProject.items]
      .filter((it) => byState.has(it.stateId))
      .sort((a, b) => (order.get(a.stateId)! - order.get(b.stateId)!))
      .map((it) => it.id);
  }, [drawerProject]);

  return (
    <div className="flex h-full">
      <Sidebar route={route} go={go} rail={rail} onToggle={toggleSidebar} />
      {(route.name === "attention" || (route.name === "project" && current)) && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CachedBanner />
          {route.name === "attention" && <Attention openItem={setDrawer} goTimeline={() => go({ name: "timeline" })} />}
          {route.name === "project" && current && current.locked && <LockScreen project={current} />}
          {route.name === "project" && current && !current.locked && (
            <Board ref={board} project={current} openItem={setDrawer} selectedId={drawer?.itemId} onNewItem={() => setCapture(true)} />
          )}
        </div>
      )}
      {route.name === "editor" && (
        <Editor
          key={route.postId ?? ""}
          goSettings={() => go({ name: "settings", tab: "publishing" })}
          goBuffer={(focus) => go({ name: "buffer", focus })}
          goTimeline={(day) => go({ name: "timeline", day })}
          openId={route.postId}
        />
      )}
      {route.name === "buffer" && (
        <Buffer goSettings={() => go({ name: "settings", tab: "publishing" })} goPost={(postId) => go({ name: "editor", postId })} focus={route.focus} />
      )}
      {route.name === "timeline" && (
        <Timeline
          key={route.day ?? ""}
          startDay={route.day}
          goBuffer={(focus) => go({ name: "buffer", focus })} goPost={(postId) => go({ name: "editor", postId })} openItem={setDrawer} />
      )}
      {route.name === "terminal" && <Terminal />}
      {route.name === "settings" && <Settings route={route} />}

      {drawer && drawerProject && (
        <ItemDrawer
          project={drawerProject}
          itemId={drawer.itemId}
          siblings={siblings}
          focusComposer={drawer.focusComposer}
          onNavigate={(itemId) => setDrawer({ projectId: drawer.projectId, itemId })}
          onClose={() => setDrawer(null)}
        />
      )}
      {quick && route.name !== "terminal" && (
        <QuickTerminal
          key={route.name === "editor" ? "posts" : "home"}
          kind={route.name === "editor" ? "posts" : "home"}
          left={rail ? 56 : 220}
          onClose={() => setQuick(false)}
          onOpenInTerminal={() => go({ name: "terminal" })}
        />
      )}
      <UpdateNotifier />
      <FailedPostNotifier goBuffer={(focus) => go({ name: "buffer", focus })} />
      <ShortcutSheet open={shortcuts} onOpenChange={setShortcuts} />
      <WhatsNewDialog onShowAll={() => go({ name: "settings", tab: "about" })} />
      <Capture
        open={capture}
        onOpenChange={setCapture}
        defaultProjectId={route.name === "project" ? route.projectId : undefined}
        go={go}
        openItem={setDrawer}
      />
    </div>
  );
}
