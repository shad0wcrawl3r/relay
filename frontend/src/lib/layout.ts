// Per-tab split layout: a tree of splits whose leaves are panes showing one
// session each. Every operation is pure and returns a new tree.

export type Dir = "h" | "v"; // h: children side by side (split right); v: stacked (split down)

export interface PaneNode {
  kind: "pane";
  id: string;
  sessionId: string;
}

export interface SplitNode {
  kind: "split";
  id: string;
  dir: Dir;
  sizes: number[]; // percentages, one per child
  children: LayoutNode[];
}

export type LayoutNode = PaneNode | SplitNode;

export interface Tab {
  id: string;
  name: string;
  root: LayoutNode;
  focus: string; // pane id
  zoom?: string; // pane id shown alone
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export const pane = (sessionId: string): PaneNode => ({ kind: "pane", id: uid(), sessionId });

export function panes(n: LayoutNode): PaneNode[] {
  return n.kind === "pane" ? [n] : n.children.flatMap(panes);
}

export function findPane(n: LayoutNode, id: string): PaneNode | undefined {
  return panes(n).find((p) => p.id === id);
}

const even = (n: number) => Array.from({ length: n }, () => 100 / n);

/** Splits pane `id`, putting `added` after it (or before) along `dir`. */
export function split(root: LayoutNode, id: string, dir: Dir, added: PaneNode, before = false): LayoutNode {
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.kind === "pane") {
      return n.id === id ? { kind: "split", id: uid(), dir, sizes: [50, 50], children: before ? [added, n] : [n, added] } : n;
    }
    const i = n.children.findIndex((c) => c.kind === "pane" && c.id === id);
    if (i >= 0 && n.dir === dir) {
      // Same direction: join this split rather than nesting, halving the pane.
      const sizes = [...n.sizes];
      const half = sizes[i] / 2;
      sizes.splice(i, 1, half, half);
      const children = [...n.children];
      children.splice(before ? i : i + 1, 0, added);
      return { ...n, sizes, children };
    }
    return { ...n, children: n.children.map(walk) };
  };
  return walk(root);
}

/** Removes pane `id`; null when it was the last one. */
export function remove(root: LayoutNode, id: string): LayoutNode | null {
  const walk = (n: LayoutNode): LayoutNode | null => {
    if (n.kind === "pane") return n.id === id ? null : n;
    const kept: LayoutNode[] = [];
    const sizes: number[] = [];
    n.children.forEach((c, i) => {
      const w = walk(c);
      if (w) {
        kept.push(w);
        sizes.push(n.sizes[i] ?? 0);
      }
    });
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0];
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    return { ...n, children: kept, sizes: sizes.map((s) => (s / total) * 100) };
  };
  return walk(root);
}

export function setSession(root: LayoutNode, id: string, sessionId: string): LayoutNode {
  if (root.kind === "pane") return root.id === id ? { ...root, sessionId } : root;
  return { ...root, children: root.children.map((c) => setSession(c, id, sessionId)) };
}

export function setSizes(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (root.kind === "pane") return root;
  if (root.id === splitId) return { ...root, sizes };
  return { ...root, children: root.children.map((c) => setSizes(c, splitId, sizes)) };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rects(n: LayoutNode, r: Rect, out: Map<string, Rect>) {
  if (n.kind === "pane") {
    out.set(n.id, r);
    return;
  }
  const sizes = n.sizes.length === n.children.length ? n.sizes : even(n.children.length);
  let at = 0;
  n.children.forEach((c, i) => {
    const f = sizes[i] / 100;
    rects(c, n.dir === "h" ? { x: r.x + at * r.w, y: r.y, w: f * r.w, h: r.h } : { x: r.x, y: r.y + at * r.h, w: r.w, h: f * r.h }, out);
    at += f;
  });
}

export type Move = "left" | "right" | "up" | "down";

/** The pane next to `id` in direction `move`, by on-screen geometry. */
export function neighbor(root: LayoutNode, id: string, move: Move): string | undefined {
  const all = new Map<string, Rect>();
  rects(root, { x: 0, y: 0, w: 1, h: 1 }, all);
  const from = all.get(id);
  if (!from) return undefined;
  const eps = 1e-6;
  let best: { id: string; dist: number; overlap: number } | undefined;
  for (const [pid, r] of all) {
    if (pid === id) continue;
    let dist: number;
    let overlap: number;
    if (move === "left" || move === "right") {
      dist = move === "right" ? r.x - (from.x + from.w) : from.x - (r.x + r.w);
      overlap = Math.min(from.y + from.h, r.y + r.h) - Math.max(from.y, r.y);
    } else {
      dist = move === "down" ? r.y - (from.y + from.h) : from.y - (r.y + r.h);
      overlap = Math.min(from.x + from.w, r.x + r.w) - Math.max(from.x, r.x);
    }
    if (dist < -eps || overlap <= eps) continue;
    if (!best || dist < best.dist - eps || (Math.abs(dist - best.dist) <= eps && overlap > best.overlap)) {
      best = { id: pid, dist, overlap };
    }
  }
  return best?.id;
}

export type Edge = "left" | "right" | "top" | "bottom" | "center";

/**
 * Moves pane `src` next to pane `target` (drag and drop). "center" swaps the
 * two panes' sessions and leaves the layout alone.
 */
export function movePane(root: LayoutNode, src: string, target: string, edge: Edge): LayoutNode {
  const a = findPane(root, src);
  const b = findPane(root, target);
  if (!a || !b || src === target) return root;
  if (edge === "center") return setSession(setSession(root, src, b.sessionId), target, a.sessionId);
  const without = remove(root, src);
  if (!without) return root;
  const dir: Dir = edge === "left" || edge === "right" ? "h" : "v";
  return split(without, target, dir, a, edge === "left" || edge === "top");
}
