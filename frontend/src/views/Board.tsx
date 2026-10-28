import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ChevronDown, Columns3, ListFilter, Plus, Rows3, Search } from "lucide-react";
import type { Item, Project, State } from "@/lib/api";
import { usePlane } from "@/lib/store";
import { collapsedByDefault, isDoneGroup, isOverdue, PRIORITIES, priorityLabel, stateById, stateColor } from "@/lib/plane";
import { cn } from "@/lib/utils";
import { Dot, Kbd, PriorityIcon, PrivateLock, ProjectGlyph } from "@/components/bits";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DRAG_MIME, ItemCard } from "@/components/ItemCard";
import type { OpenItem } from "@/App";

// Board UI state lives in memory only: some projects (Teaching) must never
// leave a trace on disk, and that includes their state ids.
const collapsedMemory = new Map<string, Set<string>>();
const viewMemory = new Map<string, "board" | "lanes">();

interface Filters {
  modules: Set<string>;
  labels: Set<string>;
  priorities: Set<string>;
  cycles: Set<string>;
  agentOnly: boolean;
  overdueOnly: boolean;
  query: string;
}

const emptyFilters = (): Filters => ({
  modules: new Set(),
  labels: new Set(),
  priorities: new Set(),
  cycles: new Set(),
  agentOnly: false,
  overdueOnly: false,
  query: "",
});

const NO_MODULE = "__none";

function matches(it: Item, s: State | undefined, f: Filters): boolean {
  if (f.modules.size && !(it.moduleIds?.some((m) => f.modules.has(m)) || (f.modules.has(NO_MODULE) && !it.moduleIds?.length))) return false;
  if (f.labels.size && !it.labelIds?.some((l) => f.labels.has(l))) return false;
  if (f.priorities.size && !f.priorities.has(it.priority)) return false;
  if (f.cycles.size && !it.cycleIds?.some((c) => f.cycles.has(c))) return false;
  if (f.agentOnly && !it.agent) return false;
  if (f.overdueOnly && !isOverdue(it, s)) return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    if (!it.name.toLowerCase().includes(q) && !it.key.toLowerCase().includes(q)) return false;
  }
  return true;
}

function toggle(set: Set<string>, v: string): Set<string> {
  const next = new Set(set);
  next.has(v) ? next.delete(v) : next.add(v);
  return next;
}

function useDrop(onDrop: (id: string) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        setOver(false);
        const raw = e.dataTransfer.getData(DRAG_MIME);
        if (!raw) return;
        e.preventDefault();
        onDrop(JSON.parse(raw).id);
      },
    },
  };
}

export interface BoardHandle {
  focusSearch: () => void;
  newItem: () => void;
}

interface BoardProps {
  project: Project;
  openItem: (o: OpenItem) => void;
  selectedId?: string;
  onNewItem: () => void;
}

export const Board = forwardRef<BoardHandle, BoardProps>(function Board({ project, openItem, selectedId, onNewItem }, ref) {
  const { update } = usePlane();
  const [view, setView] = useState<"board" | "lanes">(() => viewMemory.get(project.id) ?? "board");
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => collapsedMemory.get(project.id) ?? new Set(project.states.filter(collapsedByDefault).map((s) => s.id)),
  );
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const searchRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ focusSearch: () => searchRef.current?.focus(), newItem: onNewItem }), [onNewItem]);

  useEffect(() => {
    setView(viewMemory.get(project.id) ?? "board");
    setCollapsed(collapsedMemory.get(project.id) ?? new Set(project.states.filter(collapsedByDefault).map((s) => s.id)));
    setFilters(emptyFilters());
    // Only reset when switching projects, not on every sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const setCollapsedFor = (next: Set<string>) => {
    collapsedMemory.set(project.id, next);
    setCollapsed(next);
  };
  const setViewFor = (v: "board" | "lanes") => {
    viewMemory.set(project.id, v);
    setView(v);
  };

  const byState = stateById(project);
  const items = useMemo(() => project.items.filter((it) => matches(it, byState.get(it.stateId), filters)), [project, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveTo = (state: State) => (id: string) => {
    const it = project.items.find((i) => i.id === id);
    if (it && it.stateId !== state.id) update(it, { stateId: state.id });
  };

  const activeFilters = filters.modules.size + filters.labels.size + filters.priorities.size + filters.cycles.size + +filters.agentOnly + +filters.overdueOnly;
  const isLab = project.identifier.toUpperCase() === "LAB";

  const filterMenu = (label: string, set: Set<string>, key: "modules" | "labels" | "priorities" | "cycles", options: { id: string; name: string; icon?: React.ReactNode }[]) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn(set.size > 0 && "border-[#3b3b44] bg-[#18181b] text-strong")}>
          {label}
          {set.size > 0 && <span className="text-dim">{set.size}</span>}
          <ChevronDown className="size-3" strokeWidth={2} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {options.length === 0 && <div className="px-2 py-1.5 text-xs text-dim">None in this project</div>}
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.id}
            checked={set.has(o.id)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => setFilters((f) => ({ ...f, [key]: toggle(f[key], o.id) }))}
          >
            {o.icon}
            <span className="truncate">{o.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {set.size > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setFilters((f) => ({ ...f, [key]: new Set() }))}>Clear</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="drag flex min-h-14 flex-wrap items-center gap-2.5 border-b border-hairline px-5 pb-2.5 pt-10">
        <div className="mr-1.5 flex items-center gap-2.5">
          <ProjectGlyph project={project} />
          <h1 className="m-0 text-[15px] font-semibold text-strong">{project.name}</h1>
          <span className="font-mono text-[11px] text-dim">{project.identifier}</span>
          {project.private && <PrivateLock size={13} color="#5eead4" />}
        </div>
        <div className="no-drag inline-flex rounded-[7px] border border-border bg-[#0f0f11] p-0.5" role="group" aria-label="View">
          {(
            [
              ["board", "Board", <Columns3 key="b" className="size-[13px]" strokeWidth={1.8} />],
              ["lanes", "Lanes", <Rows3 key="l" className="size-[13px]" strokeWidth={1.8} />],
            ] as const
          ).map(([v, label, icon]) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => setViewFor(v)}
              className={cn("inline-flex h-[26px] items-center gap-1.5 rounded-[5px] px-2.5 text-xs text-muted-foreground hover:text-strong", view === v && "bg-[#232328] text-strong")}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        <div className="no-drag flex flex-wrap items-center gap-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className={cn((filters.agentOnly || filters.overdueOnly) && "border-[#3b3b44] bg-[#18181b] text-strong")}>
                <ListFilter className="size-[13px]" strokeWidth={1.8} />
                Filter
                {activeFilters > 0 && <span className="text-dim">{activeFilters}</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[200px]">
              <DropdownMenuCheckboxItem checked={filters.agentOnly} onSelect={(e) => e.preventDefault()} onCheckedChange={(v) => setFilters((f) => ({ ...f, agentOnly: !!v }))}>
                Agent items only
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={filters.overdueOnly} onSelect={(e) => e.preventDefault()} onCheckedChange={(v) => setFilters((f) => ({ ...f, overdueOnly: !!v }))}>
                Overdue only
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={activeFilters === 0 && !filters.query} onSelect={() => setFilters(emptyFilters())}>
                Clear all filters
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {project.modules.length > 0 &&
            filterMenu("Module", filters.modules, "modules", [...project.modules, { id: NO_MODULE, name: "No module" }])}
          {filterMenu(
            "Label",
            filters.labels,
            "labels",
            project.labels.map((l) => ({ ...l, icon: <Dot color={l.color || "#71717a"} size={6} /> })),
          )}
          {filterMenu(
            "Priority",
            filters.priorities,
            "priorities",
            PRIORITIES.map((p) => ({ id: p, name: priorityLabel(p), icon: <span className="grid w-4 place-items-center"><PriorityIcon priority={p} /></span> })),
          )}
          {project.cycles.length > 0 && filterMenu("Cycle", filters.cycles, "cycles", project.cycles)}
        </div>
        <span className="flex-1" />
        <label className="no-drag flex h-[30px] w-60 items-center gap-2 rounded-md border border-border bg-[#0f0f11] pl-2.5 pr-2 text-dim focus-within:border-[#52525b]">
          <span className="sr-only">Search work items</span>
          <Search className="size-[13px] shrink-0" strokeWidth={1.8} />
          <input
            ref={searchRef}
            type="search"
            placeholder={`Search ${project.identifier}…`}
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            onKeyDown={(e) => e.key === "Escape" && (setFilters((f) => ({ ...f, query: "" })), e.currentTarget.blur())}
            className="min-w-0 flex-1 bg-transparent text-xs text-[#e4e4e7] outline-none placeholder:text-dim [&::-webkit-search-cancel-button]:hidden"
          />
          <Kbd>⌘F</Kbd>
        </label>
        <Button className="no-drag" onClick={onNewItem}>
          <Plus className="size-[13px]" strokeWidth={2} />
          {isLab ? "New idea" : "New item"}
        </Button>
      </header>

      {view === "board" ? (
        <div className="flex flex-1 items-start gap-3 overflow-x-auto px-5 pb-6 pt-4">
          {project.states.map((s) =>
            collapsed.has(s.id) ? (
              <CollapsedColumn key={s.id} state={s} count={items.filter((i) => i.stateId === s.id).length} onExpand={() => setCollapsedFor(toggle(collapsed, s.id))} onDrop={moveTo(s)} />
            ) : (
              <Column
                key={s.id}
                project={project}
                state={s}
                items={items.filter((i) => i.stateId === s.id)}
                selectedId={selectedId}
                openItem={openItem}
                onCollapse={() => setCollapsedFor(toggle(collapsed, s.id))}
                onDrop={moveTo(s)}
              />
            ),
          )}
        </div>
      ) : (
        <Lanes
          project={project}
          items={items}
          collapsed={collapsed}
          onExpand={(id) => setCollapsedFor(toggle(collapsed, id))}
          openItem={openItem}
          selectedId={selectedId}
          moveTo={moveTo}
        />
      )}
    </main>
  );
});

function CollapsedColumn({ state, count, onExpand, onDrop }: { state: State; count: number; onExpand: () => void; onDrop: (id: string) => void }) {
  const drop = useDrop(onDrop);
  return (
    <button
      {...drop.props}
      onClick={onExpand}
      aria-label={`Expand ${state.name}, ${count} items`}
      className={cn(
        "flex w-10 shrink-0 flex-col items-center gap-2.5 self-stretch rounded-[10px] border border-column-border bg-column py-3 text-xs text-[#d4d4d8] hover:border-[#26262b]",
        drop.over && "border-[#52525b] bg-[#141417]",
      )}
    >
      <Dot color={stateColor(state)} />
      <span className="text-dim">{count}</span>
      <span className="vertical-label font-medium">{state.name}</span>
    </button>
  );
}

function Column({
  project,
  state,
  items,
  selectedId,
  openItem,
  onCollapse,
  onDrop,
}: {
  project: Project;
  state: State;
  items: Item[];
  selectedId?: string;
  openItem: (o: OpenItem) => void;
  onCollapse: () => void;
  onDrop: (id: string) => void;
}) {
  const drop = useDrop(onDrop);
  const [adding, setAdding] = useState(false);
  return (
    <section aria-label={state.name} className="flex max-h-full w-[264px] shrink-0 flex-col gap-2">
      <div className="group flex h-7 items-center gap-2 px-1 text-xs font-medium text-[#d4d4d8]">
        <button onClick={onCollapse} className="flex items-center gap-2" title="Collapse column">
          <Dot color={stateColor(state)} />
          <span>{state.name}</span>
        </button>
        <span className="font-normal text-dim">{items.length}</span>
        <button
          aria-label={`Add to ${state.name}`}
          onClick={() => setAdding(true)}
          className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-[#18181b] hover:text-strong"
        >
          <Plus className="size-[13px]" strokeWidth={2} />
        </button>
      </div>
      <div
        {...drop.props}
        className={cn(
          "flex min-h-[60px] flex-col gap-2 overflow-y-auto rounded-[10px] border border-column-border bg-column p-2",
          drop.over && "border-[#52525b] bg-[#121215]",
        )}
      >
        {items.map((it) => (
          <ItemCard
            key={it.id}
            item={it}
            project={project}
            state={state}
            selected={selectedId === it.id}
            onOpen={() => openItem({ projectId: project.id, itemId: it.id })}
          />
        ))}
        {adding ? (
          <InlineAdd project={project} state={state} onDone={() => setAdding(false)} />
        ) : (
          !isDoneGroup(state) && (
            <button onClick={() => setAdding(true)} className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs text-dim hover:bg-[#141417] hover:text-strong">
              <Plus className="size-3" strokeWidth={2} />
              Add item
            </button>
          )
        )}
      </div>
    </section>
  );
}

function InlineAdd({ project, state, onDone }: { project: Project; state: State; onDone: () => void }) {
  const { create } = usePlane();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return onDone();
    setBusy(true);
    const it = await create(project.id, name.trim(), state.id);
    setBusy(false);
    if (it) setName("");
  };
  return (
    <textarea
      autoFocus
      rows={2}
      value={name}
      disabled={busy}
      placeholder="Item title — ↵ to add, esc to cancel"
      onChange={(e) => setName(e.target.value)}
      onBlur={() => !name.trim() && onDone()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submit();
        }
        if (e.key === "Escape") onDone();
      }}
      className="resize-none rounded-lg border border-[#3a3a42] bg-card px-3 py-2.5 text-[13px] leading-[1.4] text-[#f4f4f5] outline-none placeholder:text-dim"
    />
  );
}

function Lanes({
  project,
  items,
  collapsed,
  onExpand,
  openItem,
  selectedId,
  moveTo,
}: {
  project: Project;
  items: Item[];
  collapsed: Set<string>;
  onExpand: (id: string) => void;
  openItem: (o: OpenItem) => void;
  selectedId?: string;
  moveTo: (s: State) => (id: string) => void;
}) {
  const states = project.states.filter((s) => !collapsed.has(s.id));
  const hidden = project.states.filter((s) => collapsed.has(s.id));
  const byState = stateById(project);
  const lanes = [
    ...project.modules.map((m) => ({ id: m.id, name: m.name, items: items.filter((i) => i.moduleIds?.includes(m.id)) })),
    { id: NO_MODULE, name: "No module", items: items.filter((i) => !i.moduleIds?.length) },
  ].filter((l) => l.id !== NO_MODULE || l.items.length > 0 || project.modules.length === 0);
  const cols = `repeat(${Math.max(states.length, 1)}, minmax(176px, 1fr))`;

  return (
    <div className="flex-1 overflow-auto px-5 pb-7 pt-3">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-dim">
        <span>Group by: Module</span>
        {hidden.length > 0 && <span className="ml-2">Hidden:</span>}
        {hidden.map((s) => (
          <button
            key={s.id}
            onClick={() => onExpand(s.id)}
            className="inline-flex h-6 items-center gap-1.5 rounded-full border border-dashed border-[#2a2a30] px-[9px] text-[11px] text-muted-foreground hover:border-border-strong hover:text-strong"
          >
            <Dot color={stateColor(s)} size={6} />
            {s.name} {items.filter((i) => i.stateId === s.id).length}
          </button>
        ))}
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: cols, minWidth: states.length * 186 }}>
        {states.map((s) => (
          <div key={s.id} className="flex h-[30px] items-center gap-2 border-b border-hairline px-1 text-xs font-medium text-[#d4d4d8]">
            <Dot color={stateColor(s)} />
            <span className="truncate">{s.name}</span>
            <span className="font-normal text-dim">{items.filter((i) => i.stateId === s.id).length}</span>
          </div>
        ))}
      </div>
      {lanes.map((lane) => {
        const done = lane.items.filter((i) => byState.get(i.stateId)?.group === "completed").length;
        const open = lane.items.filter((i) => !isDoneGroup(byState.get(i.stateId))).length;
        const pct = lane.items.length ? Math.round((done / lane.items.length) * 100) : 0;
        return (
          <div key={lane.id} className="mt-1.5">
            <div className="flex items-center gap-2.5 px-1 pb-2 pt-3 text-[13px]">
              <span className="font-semibold text-strong">{lane.name}</span>
              <span className="text-xs text-dim">
                {open} open · {done} done
              </span>
              {lane.id !== NO_MODULE && (
                <span className="h-1 w-[120px] overflow-hidden rounded-sm bg-hairline" aria-label={`${pct}% done`}>
                  <span className="block h-full bg-[#46a758]" style={{ width: `${pct}%` }} />
                </span>
              )}
            </div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: cols, minWidth: states.length * 186 }}>
              {states.map((s) => (
                <LaneCell
                  key={s.id}
                  items={lane.items.filter((i) => i.stateId === s.id)}
                  project={project}
                  state={s}
                  openItem={openItem}
                  selectedId={selectedId}
                  onDrop={moveTo(s)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LaneCell({
  items,
  project,
  state,
  openItem,
  selectedId,
  onDrop,
}: {
  items: Item[];
  project: Project;
  state: State;
  openItem: (o: OpenItem) => void;
  selectedId?: string;
  onDrop: (id: string) => void;
}) {
  const drop = useDrop(onDrop);
  return (
    <div
      {...drop.props}
      className={cn(
        "flex min-h-[70px] flex-col gap-1.5 rounded-lg p-1.5",
        items.length ? "border border-column-border bg-column" : "border border-dashed border-[#1c1c20]",
        drop.over && "border-solid border-[#52525b] bg-[#121215]",
      )}
    >
      {items.map((it) => (
        <ItemCard key={it.id} compact item={it} project={project} state={state} selected={selectedId === it.id} onOpen={() => openItem({ projectId: project.id, itemId: it.id })} />
      ))}
    </div>
  );
}
