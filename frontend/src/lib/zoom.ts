import { useEffect } from "react";
import { SettingsService } from "./api";

// ⌘ on macOS, Ctrl elsewhere: + (or =) zooms in, - zooms out, 0 resets.
// The zoom is saved in Go and applied to every Relay window.

const LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const isMac = navigator.userAgent.includes("Mac");

let current = 1;

const step = (dir: 1 | -1) => {
  const i = LEVELS.findIndex((l) => l >= current - 0.001);
  const at = i === -1 ? LEVELS.length - 1 : LEVELS[i] > current + 0.001 && dir === 1 ? i - 1 : i;
  return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, at + dir))];
};

/** Mount once per window: applies the saved zoom and handles the keys. */
export function useZoomKeys() {
  useEffect(() => {
    SettingsService.ApplyZoom()
      .then((z) => (current = z))
      .catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.altKey) return;
      // e.code too, so it works whatever the keyboard layout puts on that key,
      // and on the numeric keypad.
      const k = e.key;
      let next: number | null = null;
      if (k === "+" || k === "=" || e.code === "Equal" || e.code === "NumpadAdd") next = step(1);
      else if (k === "-" || k === "_" || e.code === "Minus" || e.code === "NumpadSubtract") next = step(-1);
      else if (!e.shiftKey && (k === "0" || e.code === "Digit0" || e.code === "Numpad0")) next = 1;
      if (next === null) return;
      // Captured, so xterm doesn't send ⌃- or ⌃= to the shell.
      e.preventDefault();
      e.stopPropagation();
      if (next === current) return;
      current = next;
      SettingsService.SetZoom(next)
        .then((z) => (current = z))
        .catch(() => {});
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

/** Renders nothing; mounts useZoomKeys at a window's root. */
export function ZoomKeys() {
  useZoomKeys();
  return null;
}
