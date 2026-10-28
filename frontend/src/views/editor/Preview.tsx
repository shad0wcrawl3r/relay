import { useMemo } from "react";
import { Browser } from "@wailsio/runtime";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { ImageIcon } from "lucide-react";
import { PLACEHOLDER_RE } from "./highlight";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const ICON =
  '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

function render(md: string): string {
  // Swap placeholders for figures before markdown sees them as HTML tags.
  const withFigures = md.replace(PLACEHOLDER_RE, (m) => {
    const desc = m.slice("<INSERT IMAGE HERE:".length, -1).trim();
    return `\n\n<figure class="img-placeholder">${ICON}<figcaption>${esc(desc || "Image")}</figcaption></figure>\n\n`;
  });
  // Liquid tags ({% embed %}) render on Dev.to only; show them as a note.
  const withEmbeds = withFigures.replace(/\{%\s*(\w+)\s+([^%]*?)\s*%\}/g, (_m, tag, arg) => `\n\n<p class="embed-note">${esc(tag)} · ${esc(arg)}</p>\n\n`);
  return DOMPurify.sanitize(marked.parse(withEmbeds, { async: false, gfm: true }) as string);
}

export function Preview({ title, tags, body }: { title: string; tags: string[]; body: string }) {
  const html = useMemo(() => render(body), [body]);
  return (
    <article className="mx-auto max-w-[760px] pb-16">
      <div className="mb-8 flex h-[220px] flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-border-strong text-[13px] text-muted-foreground">
        <ImageIcon className="size-6" strokeWidth={1.75} />
        Cover image — add on Dev.to
      </div>
      <h1 className="mb-3 mt-0 text-[40px] font-bold leading-[1.15] tracking-[-.02em] text-strong">{title || "Untitled post"}</h1>
      {tags.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-3 text-[15px] text-muted-foreground">
          {tags.map((t) => (
            <span key={t}>#{t}</span>
          ))}
        </div>
      )}
      <div
        className="prose-relay prose-article"
        onClick={(e) => {
          const a = (e.target as HTMLElement).closest("a");
          if (a?.href) {
            e.preventDefault();
            Browser.OpenURL(a.href);
          }
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
