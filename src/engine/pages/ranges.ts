// Page range strings as staff type them: "1-3, 5, 8-" or "2-z". 1-based and inclusive.
// "z" or an open end means the last page. Order and repeats are kept ("3,1,1").

export class RangeSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RangeSyntaxError";
  }
}

/** Parses a range string into 0-based page indices. Empty string = all pages. */
export function parseRanges(text: string, pageCount: number): number[] {
  const t = text.trim();
  if (!t) return allPages(pageCount);
  const out: number[] = [];
  for (const raw of t.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d+|z)?\s*(-)?\s*(\d+|z)?$/i.exec(part);
    if (!m || (!m[1] && !m[3])) throw new RangeSyntaxError(`"${part}" is not a page range`);
    const num = (s: string | undefined, dflt: number) =>
      s === undefined ? dflt : s.toLowerCase() === "z" ? pageCount : Number(s);
    const from = num(m[1], 1);
    const to = m[2] ? num(m[3], pageCount) : from;
    for (const n of [from, to]) {
      if (n < 1 || n > pageCount) {
        throw new RangeSyntaxError(`page ${n} is outside 1-${pageCount}`);
      }
    }
    const step = from <= to ? 1 : -1;
    for (let p = from; p !== to + step; p += step) out.push(p - 1);
  }
  if (!out.length) throw new RangeSyntaxError("no pages selected");
  return out;
}

export function allPages(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, i) => i);
}

/** 0-based indices -> compact qpdf page spec ("1-3,5"). */
export function toQpdfRange(indices: number[]): string {
  const runs: [number, number][] = [];
  for (const p of indices) {
    const last = runs[runs.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else runs.push([p, p]);
  }
  return runs.map(([a, b]) => (a === b ? `${a + 1}` : `${a + 1}-${b + 1}`)).join(",");
}

/** Inverse of parseRanges for display: [0,1,2,4] -> "1-3, 5". */
export function formatRanges(indices: number[]): string {
  return toQpdfRange(indices).replaceAll(",", ", ");
}
