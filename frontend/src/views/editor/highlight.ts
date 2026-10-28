// Light markdown highlighting for the editor. Every token keeps its exact
// characters: the highlighted layer sits under a transparent textarea, so any
// change in width would put the caret out of step with the text.

export type Tok = { t: string; c?: string };

export const C = {
  punct: "md-punct",
  strong: "md-strong",
  em: "md-em",
  fence: "md-fence",
  code: "md-code",
  kw: "md-kw",
  fn: "md-fn",
  link: "md-link",
  placeholder: "md-ph",
  quote: "md-quote",
};

export const PLACEHOLDER_RE = /<INSERT IMAGE HERE:[^>\n]*>/g;

const KEYWORDS = new Set(
  (
    "func return if else for range go defer package import type struct interface map chan var const switch case default break continue select " +
    "error string int bool nil true false function let await async class extends new this export from def self None True False fn pub use impl mut match"
  ).split(" "),
);

const SHELLS = new Set(["bash", "sh", "shell", "zsh", "console", "terminal"]);

function inline(src: string): Tok[] {
  const out: Tok[] = [];
  const re =
    /(<INSERT IMAGE HERE:[^>\n]*>)|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\s][^*\n]*\*)|(!?\[[^\]\n]*\]\([^)\n]*\))|(\{%[^%\n]*%\})|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    const i = m.index!;
    if (i > last) out.push({ t: src.slice(last, i) });
    const s = m[0];
    if (m[1]) out.push({ t: s, c: C.placeholder });
    else if (m[2]) out.push({ t: "`", c: C.punct }, { t: s.slice(1, -1), c: C.code }, { t: "`", c: C.punct });
    else if (m[3] || m[4]) out.push({ t: s.slice(0, 2), c: C.punct }, { t: s.slice(2, -2), c: C.strong }, { t: s.slice(-2), c: C.punct });
    else if (m[5]) out.push({ t: "*", c: C.punct }, { t: s.slice(1, -1), c: C.em }, { t: "*", c: C.punct });
    else if (m[6]) {
      const close = s.indexOf("](");
      const open = s.startsWith("!") ? 2 : 1;
      out.push(
        { t: s.slice(0, open), c: C.punct },
        { t: s.slice(open, close), c: C.strong },
        { t: "](", c: C.punct },
        { t: s.slice(close + 2, -1), c: C.link },
        { t: ")", c: C.punct },
      );
    } else if (m[7]) out.push({ t: s, c: C.kw });
    else if (m[8]) out.push({ t: s, c: C.link });
    last = i + s.length;
  }
  if (last < src.length) out.push({ t: src.slice(last) });
  return out;
}

function code(src: string, lang: string): Tok[] {
  const out: Tok[] = [];
  const shell = SHELLS.has(lang);
  // In shell blocks the command word (line start, or after && | ;) is the keyword.
  let expectCommand = true;
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(\/\/.*$|#.*$)|([A-Za-z_][\w-]*)|(&&|\|\||[|;])|(\s+)|(.)/g;
  for (const m of src.matchAll(re)) {
    const [s, str, comment, ident, sep, ws] = m;
    if (str) out.push({ t: s, c: C.fence });
    else if (comment && (shell ? s.startsWith("#") : s.startsWith("//") || s.startsWith("#"))) out.push({ t: s, c: C.fence });
    else if (ident) {
      const next = src[m.index! + s.length];
      if (shell) {
        out.push({ t: s, c: expectCommand ? C.kw : undefined });
        expectCommand = false;
      } else if (KEYWORDS.has(s)) out.push({ t: s, c: C.kw });
      else if (next === "(") out.push({ t: s, c: C.fn });
      else out.push({ t: s });
    } else if (sep) {
      out.push({ t: s });
      expectCommand = true;
    } else if (ws) out.push({ t: s });
    else out.push({ t: s });
  }
  return out;
}

export interface Line {
  toks: Tok[];
  cls?: string;
}

export function highlight(text: string): Line[] {
  const lines = text.split("\n");
  const out: Line[] = [];
  let fence: string | null = null;
  for (const raw of lines) {
    const fm = /^\s*(```|~~~)\s*([\w+-]*)/.exec(raw);
    if (fence !== null) {
      if (fm && fm[2] === "") {
        fence = null;
        out.push({ toks: [{ t: raw }], cls: C.fence });
      } else out.push({ toks: code(raw, fence) });
      continue;
    }
    if (fm) {
      fence = fm[2].toLowerCase();
      out.push({ toks: [{ t: raw }], cls: C.fence });
      continue;
    }
    const h = /^(#{1,6}\s+)(.*)$/.exec(raw);
    if (h) {
      out.push({ toks: [{ t: h[1], c: C.punct }, ...inline(h[2]).map((t) => (t.c ? t : { ...t, c: C.strong }))] });
      continue;
    }
    const q = /^(\s*>\s?)(.*)$/.exec(raw);
    if (q) {
      out.push({ toks: [{ t: q[1], c: C.punct }, ...inline(q[2])], cls: C.quote });
      continue;
    }
    const li = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/.exec(raw);
    if (li) {
      out.push({ toks: [{ t: li[1], c: C.punct }, ...inline(li[2])] });
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(raw)) {
      out.push({ toks: [{ t: raw, c: C.punct }] });
      continue;
    }
    out.push({ toks: inline(raw) });
  }
  return out;
}

export function countPlaceholders(text: string): number {
  return (text.match(PLACEHOLDER_RE) ?? []).length;
}
