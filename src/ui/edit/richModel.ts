// Edit PDF (B3 stage 2): the rich-text editor's model. Pure (no DOM), so it is tested
// on its own. A box is a list of paragraphs; each has its text, character runs that
// differ from its base format, and its paragraph format. Positions are (paragraph,
// offset) pairs.
import type { PlainFont, PlainParagraphStyle } from "../../engine/edit";
import type { ListStyle } from "../../engine/edit/lists";

/** Character formatting (what a run can change). */
export interface CharFmt {
  font?: PlainFont;
  /** The font's PDF or PostScript name, for the browser preview. */
  fontName?: string;
  /** The font picker's choice ("section:family"). */
  fontKey?: string;
  size?: number;
  color?: { r: number; g: number; b: number; a: number };
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  script?: "super" | "sub" | null;
  hScale?: number;
  charSpacing?: number;
  wordSpacing?: number;
  kerning?: boolean;
}

export interface ParaFmt {
  align?: PlainParagraphStyle["align"];
  leading?: number;
  indent?: { first: number; left: number; right?: number };
  spaceBefore?: number;
  spaceAfter?: number;
  list?: ListStyle | null;
}

export interface Run {
  start: number;
  end: number;
  fmt: CharFmt;
}

export interface RichPara {
  text: string;
  /** The paragraph's own character format (from the page or Add Text). */
  base: CharFmt;
  runs: Run[];
  para: ParaFmt;
}

export interface Pos {
  p: number;
  o: number;
}

const before = (a: Pos, b: Pos) => a.p < b.p || (a.p === b.p && a.o < b.o);
export const ordered = (a: Pos, b: Pos): [Pos, Pos] => (before(b, a) ? [b, a] : [a, b]);

/** Drops empty runs and joins neighbours with the same format. */
function tidy(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of [...runs].sort((a, b) => a.start - b.start)) {
    if (r.end <= r.start) continue;
    const last = out.at(-1);
    if (last && last.end === r.start && JSON.stringify(last.fmt) === JSON.stringify(r.fmt))
      last.end = r.end;
    else out.push({ ...r });
  }
  return out;
}

/** The format at every letter of a paragraph (its runs flattened). */
function formats(p: RichPara): CharFmt[] {
  const out: CharFmt[] = Array.from({ length: p.text.length }, () => ({}));
  for (const r of p.runs)
    for (let i = Math.max(0, r.start); i < Math.min(r.end, p.text.length); i++)
      out[i] = { ...out[i], ...r.fmt };
  return out;
}

/** Runs from a format per letter. */
function runsOf(fmts: CharFmt[]): Run[] {
  return tidy(
    fmts.map((fmt, i) => ({ start: i, end: i + 1, fmt })).filter((r) => Object.keys(r.fmt).length),
  );
}

/** Sets `fmt` on the text between `a` and `b`. */
export function applyChar(doc: RichPara[], a: Pos, b: Pos, fmt: CharFmt): RichPara[] {
  const [from, to] = ordered(a, b);
  return doc.map((p, i) => {
    if (i < from.p || i > to.p) return p;
    const s = i === from.p ? from.o : 0;
    const e = i === to.p ? to.o : p.text.length;
    if (e <= s) return p;
    const fmts = formats(p);
    for (let k = s; k < e; k++) fmts[k] = clean({ ...fmts[k], ...fmt }, p.base);
    return { ...p, runs: runsOf(fmts) };
  });
}

/** Sets `fmt` on every paragraph's base and clears it from their runs (the whole box). */
export function applyCharAll(doc: RichPara[], fmt: CharFmt): RichPara[] {
  const keys = Object.keys(fmt) as (keyof CharFmt)[];
  return doc.map((p) => ({
    ...p,
    base: { ...p.base, ...fmt },
    runs: tidy(
      p.runs.map((r) => {
        const f = Object.fromEntries(
          Object.entries(r.fmt).filter(([k]) => !keys.includes(k as keyof CharFmt)),
        ) as CharFmt;
        // A run's font name and picker key go with its font.
        const { fontName: _n, fontKey: _k, ...rest } = f;
        void _n;
        void _k;
        return { ...r, fmt: f.font ? f : rest };
      }),
    ).filter((r) => Object.keys(r.fmt).length),
  }));
}

/** A run's format without what its paragraph already has. */
function clean(f: CharFmt, base: CharFmt): CharFmt {
  const out: CharFmt = {};
  for (const [k, v] of Object.entries(f) as [keyof CharFmt, unknown][]) {
    if (JSON.stringify(v) !== JSON.stringify(base[k])) Object.assign(out, { [k]: v });
  }
  return out;
}

/** Sets paragraph formatting on paragraphs `from`..`to`. */
export function applyPara(doc: RichPara[], from: number, to: number, fmt: ParaFmt): RichPara[] {
  return doc.map((p, i) => (i < from || i > to ? p : { ...p, para: { ...p.para, ...fmt } }));
}

/** The character format at `pos` (the letter before it, or the first one). */
export function fmtAt(doc: RichPara[], pos: Pos): CharFmt {
  const p = doc[pos.p];
  if (!p) return {};
  const i = Math.max(0, Math.min(pos.o - 1, p.text.length - 1));
  return { ...p.base, ...(formats(p)[i] ?? {}) };
}

/** Splits the paragraph at `pos` (Enter): the new one keeps the paragraph format. */
export function splitAt(doc: RichPara[], pos: Pos): RichPara[] {
  const p = doc[pos.p];
  if (!p) return doc;
  const fmts = formats(p);
  const head: RichPara = { ...p, text: p.text.slice(0, pos.o), runs: runsOf(fmts.slice(0, pos.o)) };
  const tail: RichPara = {
    ...p,
    text: p.text.slice(pos.o),
    runs: runsOf(fmts.slice(pos.o)),
    // A list continues; the first-line indent of a plain paragraph does too.
    para: { ...p.para },
  };
  return [...doc.slice(0, pos.p), head, tail, ...doc.slice(pos.p + 1)];
}

/** Inserts plain text at `pos` in the format there (paste). New lines start paragraphs. */
export function insertText(doc: RichPara[], pos: Pos, text: string): { doc: RichPara[]; at: Pos } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let out = doc;
  let at = pos;
  lines.forEach((line, i) => {
    if (i) {
      out = splitAt(out, at);
      at = { p: at.p + 1, o: 0 };
    }
    const p = out[at.p];
    if (!p) return;
    const fmts = formats(p);
    const here = fmts[Math.max(0, at.o - 1)] ?? {};
    fmts.splice(at.o, 0, ...Array.from({ length: line.length }, () => ({ ...here })));
    const np = {
      ...p,
      text: p.text.slice(0, at.o) + line + p.text.slice(at.o),
      runs: runsOf(fmts),
    };
    out = out.map((x, k) => (k === at.p ? np : x));
    at = { p: at.p, o: at.o + line.length };
  });
  return { doc: out, at };
}

/** Indent step for the increase / decrease buttons (points: a quarter inch). */
export const INDENT_STEP = 18;

/** Moves paragraphs `from`..`to` right (+1) or left (-1) by a step, never past 0. */
export function indent(doc: RichPara[], from: number, to: number, dir: 1 | -1): RichPara[] {
  return doc.map((p, i) => {
    if (i < from || i > to) return p;
    const cur = p.para.indent ?? { first: 0, left: 0 };
    const by = Math.max(dir * INDENT_STEP, -Math.min(cur.first, cur.left));
    return {
      ...p,
      para: { ...p.para, indent: { ...cur, first: cur.first + by, left: cur.left + by } },
    };
  });
}

/** The same paragraphs as plain data for the engine (runs with their formats). */
export function toEngine(doc: RichPara[]) {
  return doc.map((p) => ({
    text: p.text,
    runs: p.runs.map((r) => ({ start: r.start, end: r.end, style: engineChar(r.fmt) })),
    // The list always goes along (null: none), so a paragraph never takes another's.
    style: { ...engineChar(p.base), ...enginePara(p.para), list: p.para.list ?? null },
  }));
}

function engineChar(f: CharFmt) {
  const { fontName: _n, fontKey: _k, script, ...rest } = f;
  void _n;
  void _k;
  return { ...rest, ...(script ? { script } : {}) };
}

function enginePara(f: ParaFmt) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
}
