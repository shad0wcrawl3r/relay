// Keys in tmux notation ("C-a", "M-Left", "%"), so bindings read from a tmux
// config match browser key events directly.

const special: Record<string, string> = {
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Enter: "Enter",
  Escape: "Escape",
  Tab: "Tab",
  Backspace: "BSpace",
  " ": "Space",
  Home: "Home",
  End: "End",
  PageUp: "PPage",
  PageDown: "NPage",
  Delete: "DC",
  Insert: "IC",
};

/** The tmux name of a key event, or null for bare modifiers and ⌘ chords. */
export function keyName(e: KeyboardEvent): string | null {
  if (e.metaKey || ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return null;
  let base: string | null = null;
  let shift = false;
  if (special[e.key] || /^F\d{1,2}$/.test(e.key)) {
    base = special[e.key] ?? e.key;
    shift = e.shiftKey;
  } else if (e.ctrlKey || e.altKey) {
    // With ⌥ on macOS e.key is a symbol (⌥a → å); use the physical key.
    if (/^Key[A-Z]$/.test(e.code)) base = e.code.slice(3).toLowerCase();
    else if (/^Digit\d$/.test(e.code)) base = e.code.slice(5);
    else if (e.key.length === 1) base = e.key;
    if (base && e.shiftKey && /^[a-z]$/.test(base) && !e.ctrlKey) base = base.toUpperCase();
  } else if (e.key.length === 1) {
    base = e.key;
  }
  if (!base) return null;
  return (e.ctrlKey ? "C-" : "") + (e.altKey ? "M-" : "") + (shift ? "S-" : "") + base;
}

const glyph: Record<string, string> = { Left: "←", Right: "→", Up: "↑", Down: "↓", Enter: "⏎", Escape: "esc", Tab: "⇥", BSpace: "⌫", Space: "␣", PPage: "PgUp", NPage: "PgDn" };

/** "C-a" → "⌃A", "M-Left" → "⌥←". */
export function showKey(k: string): string {
  let out = "";
  let rest = k;
  while (rest.length > 2 && rest[1] === "-" && "CMS".includes(rest[0])) {
    out += { C: "⌃", M: "⌥", S: "⇧" }[rest[0]];
    rest = rest.slice(2);
  }
  const base = glyph[rest] ?? (rest.length === 1 && out.includes("⌃") ? rest.toUpperCase() : rest);
  return out + base;
}
