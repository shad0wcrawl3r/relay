import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlane } from "@/lib/store";
import { stateById } from "@/lib/plane";
import { Sidebar } from "@/components/Sidebar";
import { Capture } from "@/components/Capture";
import { ItemDrawer } from "@/components/ItemDrawer";
import { Attention } from "@/views/Attention";
import { Board, type BoardHandle } from "@/views/Board";
import { Editor } from "@/views/editor/Editor";
import { Settings } from "@/views/Settings";
import { Terminal } from "@/views/terminal/Terminal";

export type Route = { name: "attention" } | { name: "project"; projectId: string } | { name: "editor" } | { name: "terminal" } | { name: "settings" };

export interface OpenItem {
  projectId: string;
  itemId: string;
  focusComposer?: boolean;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export default function App() {
  const { projects, project, syncNow } = usePlane();
  const [route, setRoute] = useState<Route>({ name: "attention" });
  const [drawer, setDrawer] = useState<OpenItem | null>(null);
  const [capture, setCapture] = useState(false);
  const board = useRef<BoardHandle>(null);
  const pendingG = useRef(0);

  const go = useCallback((r: Route) => {
    setRoute(r);
    setDrawer(null);
  }, []);

  const current = route.name === "project" ? project(route.projectId) : undefined;
  const drawerProject = drawer ? project(drawer.projectId) : undefined;

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
        syncNow();
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
      if (k === "a" && Date.now() - pendingG.current < 1000) {
        go({ name: "attention" });
        return;
      }
      if (/^[1-9]$/.test(k) && projects[Number(k) - 1]) {
        go({ name: "project", projectId: projects[Number(k) - 1].id });
        return;
      }
      if (k === "e") go({ name: "editor" });
      if (k === "t") go({ name: "terminal" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [route, projects, capture, go, syncNow]);

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
      <Sidebar route={route} go={go} rail={route.name === "editor" || route.name === "terminal"} />
      {route.name === "attention" && <Attention openItem={setDrawer} />}
      {route.name === "project" && current && (
        <Board ref={board} project={current} openItem={setDrawer} selectedId={drawer?.itemId} onNewItem={() => setCapture(true)} />
      )}
      {route.name === "editor" && <Editor />}
      {route.name === "terminal" && <Terminal />}
      {route.name === "settings" && <Settings />}

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
