import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  Code,
  Heading,
  ImagePlus,
  Italic,
  Link,
  List,
  ListOrdered,
  MoreVertical,
  Quote,
  SquareCode,
  Zap,
} from "lucide-react";
import { highlight } from "./highlight";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

export interface EditorHandle {
  insertAtCursor: (text: string) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onInsertImage: () => void;
  moreMenu: React.ReactNode;
}

/** Replace [start,end) keeping the browser's undo stack where possible. */
function replaceRange(ta: HTMLTextAreaElement, start: number, end: number, text: string, selStart?: number, selEnd?: number) {
  ta.focus();
  ta.setSelectionRange(start, end);
  const ok = document.execCommand?.("insertText", false, text);
  if (!ok) {
    ta.setRangeText(text, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (selStart !== undefined) ta.setSelectionRange(selStart, selEnd ?? selStart);
}

export const MarkdownEditor = forwardRef<EditorHandle, Props>(function MarkdownEditor({ value, onChange, onInsertImage, moreMenu }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [activeLine, setActiveLine] = useState(-1);
  const lines = useMemo(() => highlight(value), [value]);
  const gutterWidth = Math.max(52, 28 + String(lines.length).length * 9);

  const trackCaret = () => {
    const el = ta.current;
    if (!el) return;
    setActiveLine(el.value.slice(0, el.selectionStart).split("\n").length - 1);
  };

  // The textarea is absolutely positioned over the highlight layer, which
  // defines the height; keep the caret line in view as the page scrolls.
  useLayoutEffect(trackCaret, [value]);

  const wrap = (before: string, after = before, placeholder = "text") => {
    const el = ta.current!;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = el.value.slice(s, e) || placeholder;
    replaceRange(el, s, e, before + sel + after, s + before.length, s + before.length + sel.length);
  };

  const prefixLines = (prefix: (i: number) => string) => {
    const el = ta.current!;
    const v = el.value;
    const start = v.lastIndexOf("\n", el.selectionStart - 1) + 1;
    let end = v.indexOf("\n", el.selectionEnd);
    if (end < 0) end = v.length;
    const block = v
      .slice(start, end)
      .split("\n")
      .map((l, i) => prefix(i) + l.replace(/^(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, ""))
      .join("\n");
    replaceRange(el, start, end, block, start + block.length);
  };

  const insertBlock = (text: string, cursorOffset?: number) => {
    const el = ta.current!;
    const v = el.value;
    const s = el.selectionStart;
    const needsNl = s > 0 && v[s - 1] !== "\n" ? "\n" : "";
    const ins = needsNl + text;
    replaceRange(el, s, el.selectionEnd, ins, s + needsNl.length + (cursorOffset ?? text.length));
  };

  useImperativeHandle(ref, () => ({
    insertAtCursor: (text: string) => {
      const el = ta.current!;
      replaceRange(el, el.selectionStart, el.selectionEnd, text, el.selectionStart + text.length);
    },
    focus: () => ta.current?.focus(),
  }));

  const codeBlock = () => {
    const el = ta.current!;
    const sel = el.value.slice(el.selectionStart, el.selectionEnd);
    insertBlock("```\n" + sel + "\n```\n", 3);
  };

  const tools: ({ label: string; icon: React.ReactNode; run: () => void; kbd?: string } | "sep")[] = [
    { label: "Bold", kbd: "⌘B", icon: <Bold />, run: () => wrap("**") },
    { label: "Italic", kbd: "⌘I", icon: <Italic />, run: () => wrap("_") },
    { label: "Link", icon: <Link />, run: () => wrap("[", "](https://)", "link text") },
    "sep",
    { label: "Ordered list", icon: <ListOrdered />, run: () => prefixLines((i) => `${i + 1}. `) },
    { label: "Bulleted list", icon: <List />, run: () => prefixLines(() => "- ") },
    { label: "Heading", icon: <Heading />, run: () => prefixLines(() => "## ") },
    { label: "Quote", icon: <Quote />, run: () => prefixLines(() => "> ") },
    "sep",
    { label: "Inline code", icon: <Code />, run: () => wrap("`", "`", "code") },
    { label: "Code block", icon: <SquareCode />, run: codeBlock },
    { label: "Embed", icon: <Zap />, run: () => insertBlock("{% embed https:// %}\n", 9) },
  ];

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "b") {
      e.preventDefault();
      wrap("**");
    } else if (mod && e.key.toLowerCase() === "i") {
      e.preventDefault();
      wrap("_");
    } else if (e.key === "Tab" && !mod) {
      e.preventDefault();
      const el = e.currentTarget;
      replaceRange(el, el.selectionStart, el.selectionEnd, "  ", el.selectionStart + 2);
    } else if (e.key === "Enter" && !mod && !e.shiftKey) {
      // Continue lists.
      const el = e.currentTarget;
      const v = el.value;
      const lineStart = v.lastIndexOf("\n", el.selectionStart - 1) + 1;
      const line = v.slice(lineStart, el.selectionStart);
      const m = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/.exec(line);
      if (!m || el.selectionStart !== el.selectionEnd) return;
      e.preventDefault();
      if (!m[4]) {
        replaceRange(el, lineStart, el.selectionStart, "", lineStart);
        return;
      }
      const marker = /\d/.test(m[2]) ? `${parseInt(m[2]) + 1}${m[2].slice(-1)}` : m[2];
      const ins = `\n${m[1]}${marker}${m[3]}`;
      replaceRange(el, el.selectionStart, el.selectionEnd, ins, el.selectionStart + ins.length);
    }
  };

  return (
    <div>
      <div
        role="toolbar"
        aria-label="Formatting"
        className="sticky top-0 z-10 mt-7 flex flex-wrap items-center gap-0.5 rounded-t-lg border border-b-0 border-border bg-[#0f0f12] p-1"
      >
        {tools.map((t, i) =>
          t === "sep" ? (
            <span key={i} aria-hidden="true" className="mx-1.5 h-5 w-px bg-border" />
          ) : (
            <Tooltip key={t.label} label={t.kbd ? `${t.label}  ${t.kbd}` : t.label}>
              <button
                aria-label={t.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={t.run}
                className="grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-strong [&_svg]:size-[18px] [&_svg]:stroke-[1.9]"
              >
                {t.icon}
              </button>
            </Tooltip>
          ),
        )}
        <Tooltip label="Insert image placeholder">
          <button
            aria-label="Insert image placeholder"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onInsertImage}
            className="grid size-10 place-items-center rounded-md text-[#fbbf24] hover:bg-[rgba(245,158,11,.1)]"
          >
            <ImagePlus className="size-[18px]" strokeWidth={1.9} />
          </button>
        </Tooltip>
        <div className="grow" />
        {moreMenu}
      </div>

      <div className="relative rounded-b-lg border border-border bg-[#0c0c0e] py-4 font-mono text-sm leading-[22px] text-[#d4d4d8]" onClick={() => ta.current?.focus()}>
        <div aria-hidden="true" className="pointer-events-none">
          {lines.map((l, i) => (
            <div key={i} className={cn("flex min-h-[22px]", i === activeLine && "bg-white/[.035]")}>
              <span
                className={cn("shrink-0 select-none pr-4 text-right", i === activeLine ? "text-[#a1a1aa]" : "text-[#3f3f46]")}
                style={{ width: gutterWidth }}
              >
                {i + 1}
              </span>
              <span className={cn("md-line min-w-0 flex-1 pr-6", l.cls)}>
                {l.toks.map((t, j) => (
                  <span key={j} className={t.c}>
                    {t.t}
                  </span>
                ))}
                {"​"}
              </span>
            </div>
          ))}
        </div>
        <textarea
          ref={ta}
          aria-label="Post body (markdown)"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onSelect={trackCaret}
          onKeyUp={trackCaret}
          onClick={trackCaret}
          onFocus={trackCaret}
          onBlur={() => setActiveLine(-1)}
          onKeyDown={onKeyDown}
          className="md-input absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent py-4 pr-6 font-mono text-sm leading-[22px] text-transparent caret-[#fafafa] outline-none"
          style={{ paddingLeft: gutterWidth }}
        />
      </div>
    </div>
  );
});

export function MoreButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label="More: canonical URL, series, description"
      {...props}
      className="grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-strong"
    >
      <MoreVertical className="size-[18px]" strokeWidth={2} />
    </button>
  );
}
