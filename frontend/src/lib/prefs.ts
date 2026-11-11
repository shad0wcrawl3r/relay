// Per-machine UI preferences in localStorage: which view was open, board
// filters, the sidebar's width. Only IDs and choices, never item text or
// anything from a locked project's content. Storage can be missing or
// throw (private window, cleared data), so every read has a fallback and a
// failed write is ignored.

export function loadPref<T>(key: string, fallback: T, valid?: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v: unknown = JSON.parse(raw);
    return valid ? (valid(v) ? v : fallback) : (v as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered; nothing depends on it.
  }
}
