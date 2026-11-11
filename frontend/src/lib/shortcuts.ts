// Relay's keyboard shortcuts, for the ⌘? sheet. The single-key view
// switches (GO_KEYS) are also what App's key handler reads, so the sheet
// can't list a key that does something else.

import type { Route } from "@/App";

/** Single keys that switch views when nothing is being typed into. */
export const GO_KEYS: Record<string, { route: Route; label: string }> = {
  e: { route: { name: "editor" }, label: "Posts" },
  b: { route: { name: "buffer" }, label: "Buffer" },
  l: { route: { name: "timeline" }, label: "Timeline" },
  t: { route: { name: "terminal" }, label: "Terminal" },
};

export interface Shortcut {
  keys: string[];
  label: string;
}
export interface ShortcutGroup {
  title: string;
  /** When the group applies, if not everywhere. */
  where?: string;
  items: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Anywhere",
    items: [
      { keys: ["⌘", "K"], label: "Quick capture and go to" },
      { keys: ["⌘", "?"], label: "Keyboard shortcuts" },
      { keys: ["⌘", "\\"], label: "Show or hide the sidebar" },
      { keys: ["⌘", "/"], label: "Quick terminal" },
      { keys: ["⌘", ","], label: "Settings" },
      { keys: ["⌘", "R"], label: "Sync with Plane" },
      { keys: ["⌘", "+"], label: "Zoom in" },
      { keys: ["⌘", "−"], label: "Zoom out" },
      { keys: ["⌘", "0"], label: "Actual size" },
    ],
  },
  {
    title: "Go to",
    where: "when you're not typing",
    items: [
      { keys: ["G", "A"], label: "Attention" },
      { keys: ["1…9"], label: "Boards, in sidebar order" },
      ...Object.entries(GO_KEYS).map(([k, v]) => ({ keys: [k.toUpperCase()], label: v.label })),
    ],
  },
  {
    title: "Attention",
    items: [
      { keys: ["J"], label: "Next item" },
      { keys: ["K"], label: "Previous item" },
      { keys: ["↵"], label: "Open the item" },
      { keys: ["D"], label: "Done (needs review)" },
      { keys: ["S"], label: "Send back (needs review)" },
      { keys: ["A"], label: "Approve (in debate)" },
    ],
  },
  {
    title: "Buffer posts",
    items: [
      { keys: ["J"], label: "Next post" },
      { keys: ["K"], label: "Previous post" },
      { keys: ["↵"], label: "Show all of the text" },
      { keys: ["E"], label: "Edit in place (⌘↵ saves)" },
      { keys: ["R"], label: "Reschedule" },
      { keys: ["C"], label: "Copy the text" },
      { keys: ["⌫"], label: "Delete (asks first)" },
    ],
  },
  {
    title: "Boards and items",
    items: [
      { keys: ["⌘", "F"], label: "Search the board" },
      { keys: ["⌘", "↵"], label: "Send a comment" },
      { keys: ["Esc"], label: "Close the item" },
    ],
  },
  {
    title: "Posts",
    items: [
      { keys: ["⌘", "S"], label: "Save now" },
      { keys: ["⌘", "B"], label: "Bold" },
      { keys: ["⌘", "I"], label: "Italic" },
    ],
  },
];
