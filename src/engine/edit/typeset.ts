// Edit PDF (B3): line layout for one paragraph. Pure: wraps words to a width with a
// measure function and places each line (or each word, for justified lines).
//
// PDFium has no word-spacing setter, so a justified line is written one word per run
// with the space stretched; the last line of a paragraph is set flush left.

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
}

export interface PlacedLine {
  text: string;
  x: number;
  y: number;
  width: number;
  runs: PlacedRun[];
}

/**
 * Splits `text` into lines no wider than `width` (a word longer than that gets its own
 * line). The first line may have its own width (an indent).
 */
export function wrapWords(
  text: string,
  width: number,
  measure: (s: string) => number,
  firstWidth = width,
): string[] {
  const words = text.split(/ +/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next) > (lines.length ? width : firstWidth) + 1e-6) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

/**
 * Lays out one paragraph from baseline `firstBaseline`, `leading` apart. With
 * `frame.wrap` false the text is one line per hard break, aligned to the frame's
 * edges (a right-aligned amount grows to the left).
 */
export function layoutParagraph(
  text: string,
  frame: LayoutFrame,
  align: Align,
  firstBaseline: number,
  leading: number,
  measure: (s: string) => number,
): PlacedLine[] {
  const first = frame.first ?? frame.l;
  const lines = frame.wrap
    ? wrapWords(text, frame.r - frame.l, measure, frame.r - first)
    : [text.replace(/ +/g, " ").trim()];
  return lines.map((line, i) => {
    const y = firstBaseline - i * leading;
    const l = i ? frame.l : first;
    const width = frame.r - l;
    const w = measure(line);
    const last = i === lines.length - 1;
    const words = line.split(" ");
    if (align === "justify" && frame.wrap && !last && words.length > 1) {
      const natural = words.reduce((a, word) => a + measure(word), 0);
      const gap = (width - natural) / (words.length - 1);
      let x = l;
      const runs = words.map((word) => {
        const run = { text: word, x, y };
        x += measure(word) + gap;
        return run;
      });
      return { text: line, x: l, y, width, runs };
    }
    const x = align === "right" ? frame.r - w : align === "center" ? (l + frame.r) / 2 - w / 2 : l;
    return { text: line, x, y, width: w, runs: [{ text: line, x, y }] };
  });
}
