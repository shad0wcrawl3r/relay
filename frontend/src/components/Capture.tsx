import { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Plus } from "lucide-react";
import { usePlane } from "@/lib/store";
import { boardsOn, captureState, glyphFor, hasIdeas } from "@/lib/plane";
import { useIntegrations } from "@/lib/integrations";
import { BufferService } from "@/lib/api";
import { addIdea, ideasOrg } from "@/lib/ideas";
import { cn, errorMessage } from "@/lib/utils";
import { Kbd, ProjectGlyph } from "@/components/bits";
import { BufferLogo } from "@/components/icons/BufferLogo";
import { useToast } from "@/components/Toaster";
import { Switch } from "@/components/ui/switch";
import type { OpenItem, Route } from "@/App";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultProjectId?: string;
  go: (r: Route) => void;
  openItem: (o: OpenItem) => void;
}

interface Option {
  id: string;
  icon: React.ReactNode;
  label: React.ReactNode;
  keys: string[];
  run: (andOpen: boolean) => void;
  /** Creates something from the typed text, rather than navigating. */
  capture?: boolean;
}

export function Capture({ open, onOpenChange, defaultProjectId, go, openItem }: Props) {
  const { projects, create, syncNow, snapshot } = usePlane();
  const planeOn = boardsOn(snapshot);
  const bufferOn = useIntegrations().buffer === true;
  const toast = useToast();
  const [text, setText] = useState("");
  const [targetId, setTargetId] = useState<string>("");
  const [queue, setQueue] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText("");
    setQueue(false);
    setActive(0);
    // The project picked in Settings → Plane, unless it's locked right now.
    const preferred = projects.find((p) => p.id === snapshot?.captureProject && !p.locked);
    setTargetId(defaultProjectId ?? preferred?.id ?? projects.find((p) => !p.locked)?.id ?? projects[0]?.id ?? "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const target = projects.find((p) => p.id === targetId);
  const targetState = target ? captureState(target, queue) : undefined;
  const ideas = !!target && hasIdeas(target);

  const close = () => onOpenChange(false);

  const options = useMemo<Option[]>(() => {
    const q = text.trim().toLowerCase();
    const opts: Option[] = [];
    if (q && target) {
      opts.push({
        id: "create",
        capture: true,
        icon: <Plus className="size-[13px]" strokeWidth={2} />,
        label: (
          <>
            Create {ideas ? "idea" : "item"}{" "}
            <span className="text-dim">
              in {target.name} → {targetState?.name ?? "default"}
            </span>
          </>
        ),
        keys: ["↵"],
        run: async (andOpen) => {
          if (busy) return;
          setBusy(true);
          const it = await create(target.id, text.trim(), targetState?.id);
          setBusy(false);
          if (!it) return;
          close();
          if (andOpen) {
            go({ name: "project", projectId: target.id });
            openItem({ projectId: target.id, itemId: it.id });
          }
        },
      });
    }
    if (q && bufferOn) {
      opts.push({
        id: "buffer-idea",
        capture: true,
        icon: <BufferLogo className="size-[13px]" />,
        label: (
          <>
            Save as Buffer idea <span className="text-dim">· stays in Buffer, not linked to Plane</span>
          </>
        ),
        keys: target ? ["⌥", "↵"] : ["↵"],
        run: async () => {
          if (busy) return;
          setBusy(true);
          try {
            // The organization the Buffer tab last showed, else the account's first.
            const org = ideasOrg() || (await BufferService.Organizations())[0]?.id;
            if (!org) throw new Error("No Buffer organization found");
            addIdea(await BufferService.CreateIdea({ organizationId: org, groupId: "", title: "", text: text.trim() }));
            toast({ tone: "success", title: "Saved to Buffer ideas" });
            close();
          } catch (err) {
            toast({ tone: "error", title: "Couldn't save the idea", body: errorMessage(err) });
          } finally {
            setBusy(false);
          }
        },
      });
    }
    const nav: Option[] = [
      ...(planeOn ? [{ id: "attention", icon: "!", label: "Attention", keys: ["G", "A"], run: () => (go({ name: "attention" }), close()) }] : []),
      ...projects.slice(0, 9).map((p, i) => ({
        id: `p-${p.id}`,
        icon: glyphFor(p).letter,
        label: `${p.name} board`,
        keys: [String(i + 1)],
        run: () => (go({ name: "project", projectId: p.id }), close()),
      })),
      { id: "editor", icon: "E", label: "Posts", keys: ["E"], run: () => (go({ name: "editor" }), close()) },
      { id: "buffer", icon: "B", label: "Buffer", keys: ["B"], run: () => (go({ name: "buffer" }), close()) },
      { id: "timeline", icon: "L", label: "Timeline", keys: ["L"], run: () => (go({ name: "timeline" }), close()) },
      { id: "terminal", icon: "T", label: "Terminal", keys: ["T"], run: () => (go({ name: "terminal" }), close()) },
      { id: "settings", icon: ",", label: "Settings", keys: ["⌘", ","], run: () => (go({ name: "settings" }), close()) },
      ...(planeOn ? [{ id: "sync", icon: "↻", label: "Sync now", keys: ["⌘", "R"], run: () => (syncNow(), close()) }] : []),
    ];
    const matched = q ? nav.filter((o) => String(o.label).toLowerCase().includes(q)) : nav;
    return [...opts, ...matched];
  }, [text, target, targetState, projects, ideas, busy, planeOn, bufferOn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setActive(0), [text]);

  const cycle = (dir: number) => {
    if (!projects.length) return;
    const i = projects.findIndex((p) => p.id === targetId);
    setTargetId(projects[(i + dir + projects.length) % projects.length].id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      cycle(e.shiftKey ? -1 : 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const andOpen = e.metaKey || e.ctrlKey;
      const opt = andOpen ? options.find((o) => o.id === "create") : e.altKey ? options.find((o) => o.id === "buffer-idea") : options[active];
      opt?.run(andOpen);
    }
  };

  const captureOpts = options.filter((o) => o.capture);
  const navOpts = options.filter((o) => !o.capture);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(4,4,6,.62)]" />
        <DialogPrimitive.Content
          aria-label="Quick capture"
          onKeyDown={onKeyDown}
          className="fixed left-1/2 top-[120px] z-50 w-[min(640px,calc(100%-32px))] -translate-x-1/2 overflow-hidden rounded-xl border border-[#2a2a30] bg-[#111114] shadow-[0_30px_90px_rgba(0,0,0,.65)] outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Quick capture</DialogPrimitive.Title>
          <label className="flex h-[58px] items-center gap-3 border-b border-hairline px-4 text-muted-foreground">
            <span className="sr-only">Capture an idea or run a command</span>
            <Plus className="size-[18px]" strokeWidth={2} />
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={projects.length || bufferOn ? "Capture an idea or run a command" : "Go to…"}
              className="min-w-0 flex-1 bg-transparent text-base text-strong outline-none placeholder:text-dim"
            />
            <Kbd>esc</Kbd>
          </label>

          {projects.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3 text-xs text-dim">
              Create in
              {projects.map((p) => {
                const on = p.id === targetId;
                const g = glyphFor(p);
                return (
                  <button
                    key={p.id}
                    aria-pressed={on}
                    onClick={() => setTargetId(p.id)}
                    className={cn("inline-flex h-7 items-center gap-[7px] rounded-[7px] border border-[#2a2a30] py-0 pl-[5px] pr-2.5 text-xs text-muted-foreground", on && "text-[#f4f4f5]")}
                    style={on ? { borderColor: g.accent, background: g.accentBg } : undefined}
                  >
                    <ProjectGlyph project={p} size={18} />
                    {p.name}
                    <span style={{ color: on ? g.fg : "#8b8b94" }}>· {captureState(p, queue)?.name ?? "—"}</span>
                  </button>
                );
              })}
              <label className="ml-auto inline-flex h-7 cursor-pointer items-center gap-2 px-1 text-xs text-muted-foreground">
                <Switch checked={queue} onCheckedChange={setQueue} />
                Queue for agent
              </label>
            </div>
          )}

          <div className="flex max-h-[360px] flex-col gap-0.5 overflow-y-auto p-2" role="listbox">
            {captureOpts.map((o, i) => (
              <OptionRow key={o.id} o={o} active={active === i} accent onHover={() => setActive(i)} />
            ))}
            {navOpts.length > 0 && <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[.06em] text-dim">Go to</div>}
            {navOpts.map((o, i) => {
              const idx = captureOpts.length + i;
              return <OptionRow key={o.id} o={o} active={active === idx} onHover={() => setActive(idx)} />;
            })}
          </div>

          {projects.length > 0 && <div className="flex flex-wrap items-center gap-4 border-t border-hairline bg-[#0d0d10] px-4 py-2.5 text-[11px] text-dim">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↵</Kbd>create
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>⌘↵</Kbd>create &amp; open
            </span>
            {bufferOn && (
              <span className="inline-flex items-center gap-1.5">
                <Kbd>⌥↵</Kbd>Buffer idea
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Kbd>⇥</Kbd>cycle project
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>⌘K</Kbd>open from anywhere
            </span>
          </div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function OptionRow({ o, active, accent, onHover }: { o: Option; active: boolean; accent?: boolean; onHover: () => void }) {
  return (
    <button
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={() => o.run(false)}
      className={cn("flex min-h-10 w-full items-center gap-3 rounded-[7px] px-2.5 text-left text-[13px] text-[#d4d4d8]", active && "bg-[#1c1c21] text-strong")}
    >
      <span
        className={cn("grid size-6 shrink-0 place-items-center rounded-md bg-[#18181b] font-mono text-[11px] text-muted-foreground", active && accent && "bg-[#2e1a47] text-[#d8b4fe]")}
      >
        {o.icon}
      </span>
      <span className="truncate">{o.label}</span>
      <span className="ml-auto flex gap-1">
        {o.keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </span>
    </button>
  );
}
