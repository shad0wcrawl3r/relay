import { ArrowDown, ArrowUp, Check, ChevronDown } from "lucide-react";
import { PlaneService, type Project } from "@/lib/api";
import { autoColor, COLOR_NAMES, glyphFor, PALETTE } from "@/lib/plane";
import { usePlane } from "@/lib/store";
import { useToast } from "@/components/Toaster";
import { errorMessage, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** Sidebar order, colours and the quick capture project, saved by identifier. */
export function ProjectSettings() {
  const toast = useToast();
  const { projects, snapshot } = usePlane();
  if (projects.length === 0) return <span className="pt-1.5 text-xs text-dim">Connect Plane to arrange your projects.</span>;

  const run = (p: Promise<unknown>) => p.catch((err) => toast({ tone: "error", title: "Couldn't save project settings", body: errorMessage(err) }));
  const move = (i: number, dir: -1 | 1) => {
    const ids = projects.map((p) => p.identifier);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    run(PlaneService.SetProjectOrder(ids));
  };
  const capture = snapshot?.captureProject ?? "";

  return (
    <div className="flex flex-col divide-y divide-column-border rounded-[10px] border border-column-border bg-column">
      {projects.map((p, i) => (
        <div key={p.id} className="flex items-center gap-2.5 px-3 py-2">
          <ColorPicker project={p} onPick={(c) => run(PlaneService.SetProjectColor(p.identifier, c))} />
          <span className="min-w-0 flex-1 truncate text-[13px] text-strong">
            {p.name} <span className="font-mono text-[11px] text-dim">{p.identifier}</span>
          </span>
          <label className="flex items-center gap-1.5 text-xs text-dim" title="Quick capture (⌘K) starts in this project">
            <input
              type="radio"
              name="capture-project"
              checked={capture === p.id}
              onChange={() => run(PlaneService.SetCaptureProject(p.identifier))}
              className="accent-[#14b8a6]"
            />
            Capture
          </label>
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
            <ArrowUp className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${p.name} down`} disabled={i === projects.length - 1} onClick={() => move(i, 1)}>
            <ArrowDown className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function ColorPicker({ project, onPick }: { project: Project; onPick: (color: string) => void }) {
  const g = glyphFor(project);
  const swatch = (name: string) => <span className="size-3 rounded-full" style={{ background: PALETTE[name].accent }} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-[#1f1f23]"
          aria-label={`Colour for ${project.name}`}
        >
          <span className="grid size-6 place-items-center rounded-md text-[11px] font-semibold" style={{ background: g.bg, color: g.fg }}>
            {g.letter}
          </span>
          <ChevronDown className="size-3 text-dim" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        <DropdownMenuItem onSelect={() => onPick("")}>
          {swatch(autoColor(project.identifier))}
          <span className="flex-1">Automatic</span>
          {!project.color && <Check className="size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {COLOR_NAMES.map((c) => (
          <DropdownMenuItem key={c} onSelect={() => onPick(c)}>
            {swatch(c)}
            <span className={cn("flex-1 capitalize")}>{c}</span>
            {project.color === c && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
