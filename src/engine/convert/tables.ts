// Export to Excel (B5): a page's text laid out as rows and columns. Every text line is a
// row; columns are the gaps the page's multi-cell lines share, so right-aligned amounts
// line up. Plain data in, plain data out, so it is tested without PDFium.

/** One drawn character: origin baseline `y`, loose box `l`..`r`, size in points. */
export interface TableChar {
  ch: string;
  y: number;
  l: number;
  r: number;
  size: number;
}

/** A sheet cell: text, or an amount with the number of decimals it was printed with. */
export type SheetCell =
  | string
  | { n: number; decimals: number; percent?: boolean }
  | null;

interface Cell {
  text: string;
  l: number;
  r: number;
}

/** A gap wider than this many points per point of font size starts a new cell. */
const CELL_GAP = 0.8;
/** A gap wider than this (same unit) is a space inside a cell. */
const WORD_GAP = 0.15;

function lines(chars: TableChar[]): TableChar[][] {
  const sorted = chars
    .filter((c) => c.ch.trim() !== "" && c.r > c.l)
    .sort((a, b) => b.y - a.y || a.l - b.l);
  const out: { y: number; tol: number; chars: TableChar[] }[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - c.y) <= last.tol) last.chars.push(c);
    else out.push({ y: c.y, tol: Math.max(1.5, 0.35 * c.size), chars: [c] });
  }
  return out.map((l) => l.chars.sort((a, b) => a.l - b.l));
}

function cells(line: TableChar[]): Cell[] {
  const out: Cell[] = [];
  let cur: Cell | null = null;
  let prev: TableChar | null = null;
  for (const c of line) {
    const size = Math.max(1, c.size);
    const gap = prev ? c.l - prev.r : 0;
    if (!cur || gap > CELL_GAP * size) {
      cur = { text: c.ch, l: c.l, r: c.r };
      out.push(cur);
    } else {
      cur.text += (gap > WORD_GAP * size ? " " : "") + c.ch;
      cur.r = Math.max(cur.r, c.r);
    }
    prev = c;
  }
  // A "$" printed apart from its amount belongs to it.
  for (let i = out.length - 2; i >= 0; i--) {
    const a = out[i];
    const b = out[i + 1];
    if (a && b && a.text === "$") {
      b.text = `$${b.text}`;
      b.l = a.l;
      out.splice(i, 1);
    }
  }
  return out;
}

/** Column spans: the x ranges covered by cells of lines that have two or more cells. */
function columns(rows: Cell[][]): { l: number; r: number }[] {
  const spans = rows
    .filter((r) => r.length >= 2)
    .flat()
    .map((c) => ({ l: c.l, r: c.r }))
    .sort((a, b) => a.l - b.l);
  const out: { l: number; r: number }[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.l <= last.r) last.r = Math.max(last.r, s.r);
    else out.push({ ...s });
  }
  return out;
}

function columnOf(cols: { l: number; r: number }[], c: Cell): number {
  let best = 0;
  let bestScore = -Infinity;
  for (const [i, col] of cols.entries()) {
    const overlap = Math.min(col.r, c.r) - Math.max(col.l, c.l);
    // Overlap wins; otherwise the nearest column by left edge.
    const score = overlap > 0 ? overlap : -Math.abs(col.l - c.l) - 1e6;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Amounts as printed on financial reports: "1,234.50", "$1,234", "(1,234.50)" and
 * "1,234.50-" (negative), "12.5%". Leading zeros ("00123") and long digit runs (account
 * numbers) stay text so nothing is lost.
 */
export function parseAmount(s: string): SheetCell {
  const m = /^(\()?(-)?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\))?(-)?(%)?$/.exec(s.trim());
  if (!m) return null;
  const [, open, minus, int = "", frac = "", close, trail, pct] = m;
  if (!!open !== !!close) return null;
  if (!int.includes(",") && ((int.length > 1 && int.startsWith("0")) || int.length >= 8)) {
    return null;
  }
  const negative = !!open || !!minus || !!trail;
  if ([open, minus, trail].filter(Boolean).length > 1) return null;
  let n = Number(int.replace(/,/g, "") + frac);
  if (negative) n = -n;
  const decimals = frac ? frac.length - 1 : 0;
  if (pct) return { n: n / 100, decimals, percent: true };
  return { n, decimals };
}

/** One page as sheet rows: text lines top to bottom, cells in their columns. */
export function pageTable(chars: TableChar[]): SheetCell[][] {
  const rows = lines(chars).map(cells);
  const cols = columns(rows);
  return rows.map((row) => {
    const out: SheetCell[] = [];
    for (const c of row) {
      const i = cols.length ? columnOf(cols, c) : 0;
      const prev = out[i];
      const text = typeof prev === "string" ? `${prev} ${c.text}` : c.text;
      out[i] = text;
    }
    return Array.from(out, (v) => (typeof v === "string" ? (parseAmount(v) ?? v) : null));
  });
}
