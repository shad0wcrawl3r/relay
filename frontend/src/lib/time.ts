const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseDate(s?: string | null): Date | null {
  if (!s || s.startsWith("0001-")) return null;
  // Plane target dates are bare YYYY-MM-DD; read them as local dates.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function shortDate(s?: string | null | Date): string {
  const d = s instanceof Date ? s : parseDate(s);
  if (!d) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function ago(s?: string | null | Date, now = Date.now()): string {
  const d = s instanceof Date ? s : parseDate(s);
  if (!d) return "";
  const sec = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  return shortDate(d);
}

/** Seconds-precision "14s ago" for sync status. */
export function syncedAgo(s: string, now = Date.now()): string {
  const d = parseDate(s);
  if (!d) return "";
  const sec = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  return ago(d, now);
}

export function duration(s?: string | null, now = Date.now()): string {
  const d = parseDate(s);
  if (!d) return "";
  const min = Math.max(0, Math.round((now - d.getTime()) / 60000));
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysLate(s?: string | null): number {
  const d = parseDate(s);
  if (!d) return 0;
  return Math.round((startOfToday().getTime() - d.getTime()) / 86400000);
}

export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, "")}k`;
}
