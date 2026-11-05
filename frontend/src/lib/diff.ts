import { diffLines, diffWordsWithSpace } from "diff";

// The diff model behind DiffView: line diff, word-level highlights inside
// changed lines, and the collapsed context between changes. Kept free of
// React so the Git views can reuse it with other sources.

/** A run of text in a changed line; changed marks the words that differ. */
export interface Segment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  kind: "context" | "add" | "del";
  /** 1-based line numbers; a side the line doesn't exist on is undefined. */
  oldNo?: number;
  newNo?: number;
  text: string;
  /** Word-level segments, when the line pairs with one on the other side. */
  segments?: Segment[];
}

export interface DiffModel {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** True when both sides are identical. */
  same: boolean;
}

const splitLines = (value: string) => {
  const out = value.split("\n");
  // diffLines keeps each line's newline, so the split leaves a trailing "".
  if (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out;
};

// Word highlights only help when the lines are mostly alike; a rewritten
// line reads better as a plain delete and add.
const MAX_WORD_DIFF = 2000;
const wordSegments = (before: string, after: string): [Segment[], Segment[]] | null => {
  if (before.length + after.length > MAX_WORD_DIFF) return null;
  const parts = diffWordsWithSpace(before, after);
  let common = 0;
  for (const p of parts) if (!p.added && !p.removed) common += p.value.length;
  if (common < Math.max(before.length, after.length) * 0.4) return null;
  const left: Segment[] = [];
  const right: Segment[] = [];
  for (const p of parts) {
    if (!p.added) left.push({ text: p.value, changed: !!p.removed });
    if (!p.removed) right.push({ text: p.value, changed: !!p.added });
  }
  return [left, right];
};

export function computeDiff(oldText: string, newText: string): DiffModel {
  const norm = (s: string) => s.replace(/\r\n/g, "\n");
  const a = norm(oldText);
  const b = norm(newText);
  const lines: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  let added = 0;
  let removed = 0;
  // Pending deletes, paired with the adds that follow for word highlights.
  let dels: DiffLine[] = [];

  // Every line ends in a newline, so a missing one at the end isn't a change.
  const terminated = (s: string) => (s === "" || s.endsWith("\n") ? s : s + "\n");
  for (const part of diffLines(terminated(a), terminated(b))) {
    const texts = splitLines(part.value);
    if (part.removed) {
      for (const text of texts) {
        const line: DiffLine = { kind: "del", oldNo: oldNo++, text };
        lines.push(line);
        dels.push(line);
        removed++;
      }
      continue;
    }
    if (part.added) {
      texts.forEach((text, i) => {
        const line: DiffLine = { kind: "add", newNo: newNo++, text };
        const pair = dels[i];
        const words = pair && wordSegments(pair.text, text);
        if (words) [pair.segments, line.segments] = words;
        lines.push(line);
        added++;
      });
      dels = [];
      continue;
    }
    dels = [];
    for (const text of texts) lines.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, text });
  }
  return { lines, added, removed, same: added === 0 && removed === 0 };
}

/** Visible lines, with collapsed runs of unchanged lines between them. */
export type Row = { type: "line"; index: number } | { type: "gap"; from: number; to: number };

/**
 * Rows to show: every change plus `context` lines around it. Unchanged runs
 * longer than that collapse into a gap, unless their start index is in
 * `expanded`.
 */
export function visibleRows(model: DiffModel, context: number, expanded: ReadonlySet<number>, all = false): Row[] {
  const n = model.lines.length;
  if (all || model.same) return model.lines.map((_, index) => ({ type: "line", index }));
  const keep = new Array<boolean>(n).fill(false);
  model.lines.forEach((l, i) => {
    if (l.kind === "context") return;
    for (let j = Math.max(0, i - context); j <= Math.min(n - 1, i + context); j++) keep[j] = true;
  });
  const rows: Row[] = [];
  for (let i = 0; i < n;) {
    if (keep[i]) {
      rows.push({ type: "line", index: i++ });
      continue;
    }
    let j = i;
    while (j < n && !keep[j]) j++;
    // A gap of one line costs as much room as the line itself.
    if (j - i <= 1 || expanded.has(i)) for (let k = i; k < j; k++) rows.push({ type: "line", index: k });
    else rows.push({ type: "gap", from: i, to: j });
    i = j;
  }
  return rows;
}

/** Side-by-side pairs: context on both sides, changes zipped del ↔ add. */
export type SplitRow = { type: "pair"; left?: number; right?: number } | { type: "gap"; from: number; to: number };

export function splitRows(model: DiffModel, rows: Row[]): SplitRow[] {
  const out: SplitRow[] = [];
  let dels: number[] = [];
  let adds: number[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ type: "pair", left: dels[i], right: adds[i] });
    dels = [];
    adds = [];
  };
  for (const r of rows) {
    if (r.type === "gap") {
      flush();
      out.push(r);
      continue;
    }
    const line = model.lines[r.index];
    if (line.kind === "del") {
      if (adds.length) flush();
      dels.push(r.index);
    } else if (line.kind === "add") adds.push(r.index);
    else {
      flush();
      out.push({ type: "pair", left: r.index, right: r.index });
    }
  }
  flush();
  return out;
}
