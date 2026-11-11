// Time helpers for the Buffer queue: posting slots are wall-clock times in
// the channel's timezone, Relay shows and groups in the machine's.

import type { BufferChannel, BufferPost } from "@/lib/api";

/** The wall-clock parts of t in timeZone. */
function partsIn(t: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const get = (type: string) => f.formatToParts(t).find((p) => p.type === type)?.value ?? "";
  return { y: +get("year"), mo: +get("month"), d: +get("day"), h: +get("hour"), mi: +get("minute"), wd: get("weekday").toLowerCase().slice(0, 3) };
}

/** The instant a wall-clock time in timeZone happens. */
function fromWall(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = partsIn(new Date(guess), timeZone);
  const offset = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - guess;
  return new Date(guess - offset);
}

const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** The channel's next posting slot after `after`, or null without a schedule. */
export function nextSlotAt(c: BufferChannel | undefined, after = new Date()): Date | null {
  if (!c) return null;
  const days = (c.postingSchedule ?? []).filter((d) => !d.paused && d.times.length > 0);
  if (days.length === 0) return null;
  const tz = c.timezone && validZone(c.timezone) ? c.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (let offset = 0; offset < 8; offset++) {
    const base = partsIn(new Date(after.getTime() + offset * 86_400_000), tz);
    const sched = days.find((d) => d.day.toLowerCase().startsWith(base.wd));
    for (const t of (sched?.times ?? []).slice().sort()) {
      const [h, mi] = t.split(":").map(Number);
      const at = fromWall(base.y, base.mo, base.d, h, mi, tz);
      if (at > after) return at;
    }
  }
  return null;
}

/** When a post belongs in the list: when it went out if sent, otherwise when it's due. */
export function postTime(p: BufferPost): Date | null {
  const v = p.status === "sent" ? p.sentAt || p.dueAt : p.status === "draft" ? p.createdAt : p.dueAt;
  if (!v || v.startsWith("0001")) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function dayLabel(d: Date, now = new Date()): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(now)) / 86_400_000);
  const date = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  if (diff === 0) return `Today · ${date}`;
  if (diff === 1) return `Tomorrow · ${date}`;
  if (diff === -1) return `Yesterday · ${date}`;
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** d moved to another day, keeping its time of day. */
export function onDay(d: Date, day: Date): Date {
  const x = new Date(day);
  x.setHours(d.getHours(), d.getMinutes(), 0, 0);
  return x;
}

/** For a datetime-local input. */
export const localInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
