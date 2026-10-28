import type { Item, Project, State } from "./api";
import { daysLate, parseDate, startOfToday } from "./time";

/** Normalised state name used for behaviour (attention groups, actions). */
export const norm = (s?: string) => (s ?? "").trim().toLowerCase();

// Colours from design/README.md §4, keyed by state name; Plane's own colour
// is the fallback for states the design doesn't know.
const STATE_COLORS: Record<string, string> = {
  backlog: "#60646c",
  todo: "#60646c",
  "ready for agent": "#3b82f6",
  "agent working": "#6366f1",
  "in progress": "#f59e0b",
  building: "#f59e0b",
  blocked: "#ef4444",
  "waiting on student": "#ef4444",
  "needs review": "#ec4899",
  "in debate": "#ec4899",
  done: "#46a758",
  cancelled: "#9aa4bc",
  idea: "#a855f7",
  approved: "#14b8a6",
};

export function stateColor(s?: State): string {
  if (!s) return "#60646c";
  return STATE_COLORS[norm(s.name)] ?? s.color ?? "#60646c";
}

export interface Glyph {
  letter: string;
  bg: string;
  fg: string;
  accent: string;
  accentBg: string;
}

const GLYPHS: Record<string, Glyph> = {
  WORK: { letter: "W", bg: "#1e293b", fg: "#93c5fd", accent: "#3b82f6", accentBg: "#111a2b" },
  LAB: { letter: "L", bg: "#2e1a47", fg: "#d8b4fe", accent: "#a855f7", accentBg: "#1c1426" },
  TEACH: { letter: "T", bg: "#123534", fg: "#5eead4", accent: "#14b8a6", accentBg: "#0d1f1d" },
};

export function glyphFor(p: Pick<Project, "identifier" | "name">): Glyph {
  return (
    GLYPHS[p.identifier?.toUpperCase()] ?? {
      letter: (p.name || p.identifier || "?").charAt(0).toUpperCase(),
      bg: "#27272a",
      fg: "#d4d4d8",
      accent: "#71717a",
      accentBg: "#18181b",
    }
  );
}

export const isDoneGroup = (s?: State) => s?.group === "completed" || s?.group === "cancelled";

/** Backlog, Done and Cancelled start collapsed on the board. */
export function collapsedByDefault(s: State): boolean {
  return isDoneGroup(s) || norm(s.name) === "backlog";
}

export function stateById(p: Project): Map<string, State> {
  return new Map(p.states.map((s) => [s.id, s]));
}

export function findState(p: Project, ...names: string[]): State | undefined {
  for (const n of names) {
    const s = p.states.find((st) => norm(st.name) === norm(n));
    if (s) return s;
  }
  return undefined;
}

export function findStateByGroup(p: Project, ...groups: string[]): State | undefined {
  for (const g of groups) {
    const s = p.states.find((st) => st.group === g);
    if (s) return s;
  }
  return undefined;
}

export function defaultState(p: Project): State | undefined {
  return p.states.find((s) => s.default) ?? findStateByGroup(p, "backlog", "unstarted") ?? p.states[0];
}

/** Default state for quick capture: Lab → Idea, others → Backlog. */
export function captureState(p: Project, queueForAgent: boolean): State | undefined {
  if (queueForAgent) return findState(p, "Ready for Agent") ?? defaultState(p);
  if (p.identifier.toUpperCase() === "LAB") return findState(p, "Idea") ?? defaultState(p);
  return findState(p, "Backlog") ?? defaultState(p);
}

export function isOverdue(it: Item, s?: State): boolean {
  if (!it.targetDate || isDoneGroup(s)) return false;
  const d = parseDate(it.targetDate);
  return !!d && d < startOfToday();
}

export function openCount(p: Project): number {
  const byId = stateById(p);
  return p.items.filter((it) => !isDoneGroup(byId.get(it.stateId))).length;
}

export type AttentionKind = "review" | "debate" | "blocked" | "overdue";

export interface AttentionRow {
  kind: AttentionKind;
  project: Project;
  item: Item;
  state?: State;
}

export const ATTENTION_GROUPS: { kind: AttentionKind; name: string; color: string; hint: string }[] = [
  { kind: "review", name: "Needs review", color: "#ec4899", hint: "Agent output handed back" },
  { kind: "debate", name: "In debate", color: "#ec4899", hint: "Lab ideas waiting for your reply" },
  { kind: "blocked", name: "Blocked", color: "#ef4444", hint: "" },
  { kind: "overdue", name: "Overdue", color: "#f97316", hint: "Past target date" },
];

/** Everything waiting on the user, each item in at most one group. */
export function attentionRows(projects: Project[]): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const p of projects) {
    const byId = stateById(p);
    for (const it of p.items) {
      const s = byId.get(it.stateId);
      const n = norm(s?.name);
      let kind: AttentionKind | null = null;
      if (n === "needs review") kind = "review";
      // "Your turn" needs a known thread; with no comments yet the agent hasn't replied.
      else if (n === "in debate") kind = it.lastCommentByAgent || it.commentCount < 0 ? "debate" : null;
      else if (n === "blocked" || n === "waiting on student") kind = "blocked";
      if (isOverdue(it, s) && kind !== "review" && kind !== "debate") kind = "overdue";
      if (kind) rows.push({ kind, project: p, item: it, state: s });
    }
  }
  const late = (r: AttentionRow) => daysLate(r.item.targetDate);
  return rows.sort((a, b) =>
    a.kind === "overdue" && b.kind === "overdue" ? late(b) - late(a) : (b.item.updatedAt ?? "").localeCompare(a.item.updatedAt ?? ""),
  );
}

export const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const priorityLabel = (p: string) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : "None");

export function planeURL(appUrl: string, workspace: string, it: Item): string {
  return `${appUrl}/${workspace}/browse/${it.key}/`;
}
