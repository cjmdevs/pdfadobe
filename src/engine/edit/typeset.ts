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

/** Splits `text` into lines no wider than `width` (a word longer than that gets its own line). */
export function wrapWords(text: string, width: number, measure: (s: string) => number): string[] {
  const words = text.split(/ +/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next) > width + 1e-6) {
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
  const width = frame.r - frame.l;
  const lines = frame.wrap ? wrapWords(text, width, measure) : [text.replace(/ +/g, " ").trim()];
  return lines.map((line, i) => {
    const y = firstBaseline - i * leading;
    const w = measure(line);
    const last = i === lines.length - 1;
    const words = line.split(" ");
    if (align === "justify" && frame.wrap && !last && words.length > 1) {
      const natural = words.reduce((a, word) => a + measure(word), 0);
      const gap = (width - natural) / (words.length - 1);
      let x = frame.l;
      const runs = words.map((word) => {
        const run = { text: word, x, y };
        x += measure(word) + gap;
        return run;
      });
      return { text: line, x: frame.l, y, width, runs };
    }
    const x =
      align === "right"
        ? frame.r - w
        : align === "center"
          ? (frame.l + frame.r) / 2 - w / 2
          : frame.l;
    return { text: line, x, y, width: w, runs: [{ text: line, x, y }] };
  });
}
