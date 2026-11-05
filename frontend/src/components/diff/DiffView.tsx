import { useMemo, useState, type ReactNode } from "react";
import { ChevronsUpDown, Columns2, Rows3, WrapText } from "lucide-react";
import { computeDiff, splitRows, visibleRows, type DiffLine, type DiffModel, type Segment } from "@/lib/diff";
import { cn } from "@/lib/utils";

// A diff viewer for two versions of a text: unified or side by side, with
// word-level highlights and collapsed unchanged lines. Built for Dev.to drift
// first and the Git views later, so it takes plain text and labels, nothing
// specific to posts.

export type DiffMode = "unified" | "split";

const MODE_KEY = "relay:diff-mode";
const storedMode = (): DiffMode => (localStorage.getItem(MODE_KEY) === "split" ? "split" : "unified");

interface Props {
  oldText: string;
  newText: string;
  oldLabel: string;
  newLabel: string;
  /** Unchanged lines kept around each change. */
  context?: number;
  /** Extra controls on the right of the toolbar. */
  actions?: ReactNode;
  className?: string;
}

export function DiffView({ oldText, newText, oldLabel, newLabel, context = 3, actions, className }: Props) {
  const model = useMemo(() => computeDiff(oldText, newText), [oldText, newText]);
  const [mode, setModeState] = useState<DiffMode>(storedMode);
  const [wrap, setWrap] = useState(true);
  const [all, setAll] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const rows = useMemo(() => visibleRows(model, context, expanded, all), [model, context, expanded, all]);

  const setMode = (m: DiffMode) => {
    localStorage.setItem(MODE_KEY, m);
    setModeState(m);
  };
  const expand = (from: number) => setExpanded((s) => new Set(s).add(from));

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-column-border bg-[#0c0c0e]", className)}>
      <div className="flex shrink-0 items-center gap-3 border-b border-column-border px-3 py-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span className="truncate">{oldLabel}</span>
          <span className="text-dim">→</span>
          <span className="truncate text-strong">{newLabel}</span>
        </span>
        <span className="flex shrink-0 gap-2 font-mono text-[11px]">
          <span className="text-[#4ade80]">+{model.added}</span>
          <span className="text-[#f87171]">−{model.removed}</span>
        </span>
        <span className="grow" />
        {actions}
        <ToolButton label="Show all lines" active={all} onClick={() => setAll((v) => !v)}>
          <ChevronsUpDown className="size-3.5" />
        </ToolButton>
        <ToolButton label="Wrap long lines" active={wrap} onClick={() => setWrap((v) => !v)}>
          <WrapText className="size-3.5" />
        </ToolButton>
        <div className="flex rounded-md border border-border p-px" role="radiogroup" aria-label="Layout">
          <ToolButton label="Unified" active={mode === "unified"} onClick={() => setMode("unified")} radio>
            <Rows3 className="size-3.5" />
          </ToolButton>
          <ToolButton label="Side by side" active={mode === "split"} onClick={() => setMode("split")} radio>
            <Columns2 className="size-3.5" />
          </ToolButton>
        </div>
      </div>

      <div className="selectable min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[20px]">
        {model.same ? (
          <p className="m-0 px-4 py-6 text-center font-sans text-[13px] text-dim">No differences.</p>
        ) : mode === "unified" ? (
          <table className={cn("w-full border-collapse", !wrap && "w-max min-w-full")}>
            <tbody>
              {rows.map((r) =>
                r.type === "gap" ? (
                  <Gap key={`g${r.from}`} count={r.to - r.from} span={4} onClick={() => expand(r.from)} />
                ) : (
                  <UnifiedRow key={r.index} line={model.lines[r.index]} wrap={wrap} />
                ),
              )}
            </tbody>
          </table>
        ) : (
          <SplitTable model={model} rows={rows} wrap={wrap} onExpand={expand} />
        )}
      </div>
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  radio,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  radio?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      role={radio ? "radio" : undefined}
      aria-checked={radio ? active : undefined}
      aria-pressed={radio ? undefined : active}
      onClick={onClick}
      className={cn("grid size-6 place-items-center rounded text-dim hover:text-strong", active && "bg-[#1c1c20] text-strong")}
    >
      {children}
    </button>
  );
}

const tone = {
  add: {
    row: "bg-[rgba(70,167,88,.10)]",
    gutter: "bg-[rgba(70,167,88,.16)] text-[#86efac]",
    word: "bg-[rgba(70,167,88,.38)]",
    mark: "+",
  },
  del: {
    row: "bg-[rgba(239,68,68,.10)]",
    gutter: "bg-[rgba(239,68,68,.16)] text-[#fca5a5]",
    word: "bg-[rgba(239,68,68,.38)]",
    mark: "−",
  },
  context: { row: "", gutter: "text-[#52525b]", word: "", mark: " " },
} as const;

function Text({ line, wrap }: { line: DiffLine; wrap: boolean }) {
  const t = tone[line.kind];
  const body = line.segments
    ? line.segments.map((s: Segment, i) =>
        s.changed ? (
          <span key={i} className={cn("rounded-[2px]", t.word)}>
            {s.text}
          </span>
        ) : (
          s.text
        ),
      )
    : line.text;
  return (
    <span className={cn("block pr-4", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>
      {/* An empty line still needs height. */}
      {line.text === "" ? "​" : body}
    </span>
  );
}

const numCell = "w-[1%] select-none whitespace-nowrap px-2 text-right align-top text-[11px] tabular-nums";

function UnifiedRow({ line, wrap }: { line: DiffLine; wrap: boolean }) {
  const t = tone[line.kind];
  return (
    <tr className={t.row}>
      <td className={cn(numCell, t.gutter)}>{line.oldNo ?? ""}</td>
      <td className={cn(numCell, t.gutter)}>{line.newNo ?? ""}</td>
      <td className={cn("w-[1%] select-none px-1 align-top", t.gutter)}>{t.mark}</td>
      <td className="align-top text-[#d4d4d8]">
        <Text line={line} wrap={wrap} />
      </td>
    </tr>
  );
}

function Gap({ count, span, onClick }: { count: number; span: number; onClick: () => void }) {
  return (
    <tr>
      <td colSpan={span} className="p-0">
        <button
          type="button"
          onClick={onClick}
          className="flex w-full items-center gap-2 border-y border-[#1c1c20] bg-[#111114] px-3 py-0.5 text-left font-sans text-[11px] text-dim hover:text-[#93c5fd]"
        >
          <ChevronsUpDown className="size-3" />
          {count} unchanged line{count === 1 ? "" : "s"}
        </button>
      </td>
    </tr>
  );
}

function SplitTable({
  model,
  rows,
  wrap,
  onExpand,
}: {
  model: DiffModel;
  rows: ReturnType<typeof visibleRows>;
  wrap: boolean;
  onExpand: (from: number) => void;
}) {
  const pairs = useMemo(() => splitRows(model, rows), [model, rows]);
  const side = (i: number | undefined, which: "old" | "new") => {
    if (i === undefined) {
      return (
        <>
          <td className={cn(numCell, "bg-[#0f0f12]")} />
          <td className="bg-[#0f0f12] align-top" />
        </>
      );
    }
    const line = model.lines[i];
    const t = tone[line.kind];
    return (
      <>
        <td className={cn(numCell, t.gutter)}>{which === "old" ? line.oldNo : line.newNo}</td>
        <td className={cn("align-top text-[#d4d4d8]", t.row)}>
          <Text line={line} wrap={wrap} />
        </td>
      </>
    );
  };
  return (
    <table className={cn("w-full table-fixed border-collapse", !wrap && "w-max min-w-full table-auto")}>
      <colgroup>
        <col className="w-12" />
        <col />
        <col className="w-12" />
        <col />
      </colgroup>
      <tbody>
        {pairs.map((p, k) =>
          p.type === "gap" ? (
            <Gap key={`g${p.from}`} count={p.to - p.from} span={4} onClick={() => onExpand(p.from)} />
          ) : (
            <tr key={k} className="[&>td:nth-child(3)]:border-l [&>td:nth-child(3)]:border-[#1c1c20]">
              {side(p.left, "old")}
              {side(p.right, "new")}
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}
