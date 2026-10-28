// Edit PDF (B3): line layout for one paragraph. Pure: wraps words to a width with a
// measure function and places each line (or each word, for justified lines).
//
// A paragraph is a list of fragments, each in one character style ("piece": font,
// size, colour, spacing...); a word may run across several. PDFium has no word-spacing
// setter, so a justified line is written one word per run with the space stretched;
// the last line of a paragraph is set flush left.

export type Align = "left" | "center" | "right" | "justify";

export interface LayoutFrame {
  /** Left and right edge of the text area. */
  l: number;
  r: number;
  /** Where the first line starts (a first-line or hanging indent); `l` when absent. */
  first?: number;
  /** Wrap at the frame width (false: a one-line box grows instead of wrapping). */
  wrap: boolean;
}

export interface PlacedRun {
  text: string;
  /** Baseline start. */
  x: number;
  y: number;
  /** Which piece (character style) it is in. */
  piece: number;
}

export interface PlacedLine {
  text: string;
  x: number;
  y: number;
  width: number;
  runs: PlacedRun[];
}

/** Text in one character style. */
export interface Fragment {
  text: string;
  piece: number;
}

/** Width of `s` in piece `piece` (its font, size and spacing). */
export type PieceMeasure = (piece: number, s: string) => number;

/** Splits `text` into lines no wider than `width` (a word longer than that gets its own line). */
export function wrapWords(
  text: string,
  width: number,
  measure: (s: string) => number,
  firstWidth = width,
): string[] {
  const one = [{ text, piece: 0 }];
  return breakLines(tokens(one), width, (_, s) => measure(s), firstWidth).map((l) =>
    l.map((t) => t.text).join(""),
  );
}

interface Token {
  text: string;
  piece: number;
  space: boolean;
}

/** Words and single spaces, each in its piece (runs of spaces collapse to one). */
function tokens(frags: Fragment[]): Token[] {
  const out: Token[] = [];
  for (const f of frags)
    for (const part of f.text.split(/( +)/)) {
      if (!part) continue;
      const space = part.startsWith(" ");
      const prev = out.at(-1);
      if (space && (prev?.space || !prev)) continue;
      out.push({ text: space ? " " : part, piece: f.piece, space });
    }
  while (out.at(-1)?.space) out.pop();
  return out;
}

/** Tokens per line: greedy, breaking only at spaces (which are dropped at the break). */
function breakLines(
  toks: Token[],
  width: number,
  measure: PieceMeasure,
  firstWidth: number,
): Token[][] {
  const lines: Token[][] = [];
  let cur: Token[] = [];
  let curW = 0;
  let i = 0;
  while (i < toks.length) {
    // The next word: tokens up to the next space (a word may span pieces).
    let j = i;
    while (j < toks.length && !toks[j]?.space) j++;
    const word = toks.slice(i, j);
    const gap = cur.length ? toks[i - 1] : undefined;
    const gapW = gap?.space ? measure(gap.piece, " ") : 0;
    const wordW = word.reduce((a, t) => a + measure(t.piece, t.text), 0);
    const limit = lines.length ? width : firstWidth;
    if (cur.length && curW + gapW + wordW > limit + 1e-6) {
      lines.push(cur);
      cur = [...word];
      curW = wordW;
    } else {
      if (gap?.space && cur.length) cur.push(gap);
      cur.push(...word);
      curW += gapW + wordW;
    }
    i = j + 1;
  }
  if (cur.length || !lines.length) lines.push(cur);
  return lines;
}

/** Joins neighbouring tokens of the same piece into runs placed from `x`. */
function runsFrom(toks: Token[], x: number, y: number, measure: PieceMeasure): PlacedRun[] {
  const runs: PlacedRun[] = [];
  for (const t of toks) {
    const last = runs.at(-1);
    if (last && last.piece === t.piece) last.text += t.text;
    else runs.push({ text: t.text, x, y, piece: t.piece });
    x += measure(t.piece, t.text);
  }
  return runs.filter((r) => r.text.trim());
}

/**
 * Lays out one paragraph from baseline `firstBaseline`, `leading` apart. With
 * `frame.wrap` false the text is one line, aligned to the frame's edges (a
 * right-aligned amount grows to the left).
 */
export function layoutRuns(
  frags: Fragment[],
  frame: LayoutFrame,
  align: Align,
  firstBaseline: number,
  leading: number,
  measure: PieceMeasure,
): PlacedLine[] {
  const first = frame.first ?? frame.l;
  const toks = tokens(frags);
  const lines = frame.wrap ? breakLines(toks, frame.r - frame.l, measure, frame.r - first) : [toks];
  return lines.map((line, i) => {
    const y = firstBaseline - i * leading;
    const l = i ? frame.l : first;
    const width = frame.r - l;
    const text = line.map((t) => t.text).join("");
    const w = line.reduce((a, t) => a + measure(t.piece, t.text), 0);
    const last = i === lines.length - 1;
    const gaps = line.filter((t) => t.space).length;
    if (align === "justify" && frame.wrap && !last && gaps > 0) {
      // Each word on its own; the spaces stretch.
      const extra = (width - w) / gaps;
      let x = l;
      const runs: PlacedRun[] = [];
      let word: Token[] = [];
      const flush = () => {
        runs.push(...runsFrom(word, x, y, measure));
        x += word.reduce((a, t) => a + measure(t.piece, t.text), 0);
        word = [];
      };
      for (const t of line) {
        if (!t.space) {
          word.push(t);
          continue;
        }
        flush();
        x += measure(t.piece, " ") + extra;
      }
      flush();
      return { text, x: l, y, width, runs };
    }
    const x = align === "right" ? frame.r - w : align === "center" ? (l + frame.r) / 2 - w / 2 : l;
    return { text, x, y, width: w, runs: runsFrom(line, x, y, measure) };
  });
}

/** One paragraph in one style (piece 0). */
export function layoutParagraph(
  text: string,
  frame: LayoutFrame,
  align: Align,
  firstBaseline: number,
  leading: number,
  measure: (s: string) => number,
): PlacedLine[] {
  return layoutRuns([{ text, piece: 0 }], frame, align, firstBaseline, leading, (_, s) =>
    measure(s),
  );
}
