import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { isoDate, parseDate, startOfToday } from "@/lib/time";
import { cn } from "@/lib/utils";

const addDays = (n: number) => {
  const d = startOfToday();
  d.setDate(d.getDate() + n);
  return d;
};

function nextMonday() {
  const d = startOfToday();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d;
}

export function DatePicker({ current, onPick, close }: { current?: string; onPick: (d: Date | null) => void; close: () => void }) {
  const [value, setValue] = useState(current ?? "");
  const pick = (d: Date | null) => {
    onPick(d);
    close();
  };
  return (
    <div className="flex w-[220px] flex-col gap-1">
      {[
        ["Tomorrow", addDays(1)],
        ["In 3 days", addDays(3)],
        ["Next Monday", nextMonday()],
        ["In a week", addDays(7)],
      ].map(([label, d]) => (
        <button key={label as string} className="flex h-8 items-center justify-between rounded-md px-2 text-xs hover:bg-accent hover:text-strong" onClick={() => pick(d as Date)}>
          {label as string}
          <span className="text-dim">{(d as Date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        </button>
      ))}
      <div className="my-1 h-px bg-hairline" />
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const d = parseDate(value);
          if (d) pick(d);
        }}
      >
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-xs text-strong outline-none [color-scheme:dark] focus:border-[#52525b]"
        />
        <Button type="submit" size="sm">
          Set
        </Button>
      </form>
      {current && (
        <button className="mt-1 h-7 rounded-md px-2 text-left text-xs text-dim hover:bg-accent hover:text-strong" onClick={() => pick(null)}>
          Clear due date
        </button>
      )}
    </div>
  );
}

export function RescheduleButton({ current, onPick, primary, overdue }: { current?: string; onPick: (d: Date | null) => void; primary?: boolean; overdue?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={primary ? "default" : "outline"}>Reschedule</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="p-1.5">
        <DatePicker current={current} onPick={onPick} close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

export function DueChip({ current, onPick, overdue }: { current?: string; onPick: (d: Date | null) => void; overdue?: boolean }) {
  const [open, setOpen] = useState(false);
  const d = parseDate(current);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn("inline-flex h-[26px] items-center gap-1.5 rounded-md border border-[#2a2a30] bg-[#141417] px-2.5 text-xs text-[#f4f4f5] hover:border-border-strong", overdue && "text-overdue")}>
          <CalendarDays className="size-3" />
          {d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) : "No due date"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-1.5">
        <DatePicker current={current ? isoDate(d!) : ""} onPick={onPick} close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
