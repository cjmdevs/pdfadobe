// Edit PDF (B3): group a page's characters into text boxes and paragraphs, the way
// Acrobat's Edit PDF shows one box per paragraph, column or cell. Pure: works on the
// plain data from `chars.ts`, so it runs (and is tested) without PDFium.
//
// Signals, in order:
//   - rows: chars within 0.3 em of the same baseline
//   - segments: a row is cut at a gap over 0.9 em, a size change, a vertical rule, or
//     where dot leaders start or end
//   - boxes: a segment joins the box above when the size matches, the left edges line
//     up, the line spacing matches, and no rule (drawn or typed) lies between them
//   - paragraphs inside a box: a new one starts when the line above had room for the
//     next line's first word, is under 60% of the box width, ends with ":", is a value
//     after a label, starts with a bullet, or either line is only an amount
//
// Tuned on the synthetic corpus in tests/corpus/edit/ (docs/edit-spike-report.md).

import type { PageChar, Rules } from "./chars";

const BULLETS = "•▪●–-";
/** "-----", "=====" lines in typed (Courier) statements act like drawn rules. */
const TYPED_RULE = /^[-=_]{5,}$/;
/** A line that is only an amount ("1,234.", "$ 812", "(45)", "12%"). */
const AMOUNT = /^\$?\s?\(?-?\d[\d,]*\.?\d*\)?%?$/;

export interface Line {
  chars: PageChar[];
  /** Baseline. */
  y: number;
  size: number;
  text: string;
  l: number;
  b: number;
  r: number;
  t: number;
  /** Average word gap, or null for a single word. */
  gap: number | null;
  /** Font of the first char. */
  font: string;
  /** Value after a "Label:" on the same row. */
  afterLabel: boolean;
  /** Dot leaders (". . . . ."). */
  leader: boolean;
  /** Never joins a box: leaders and typed rules. */
  standalone: boolean;
}

export interface Paragraph {
  lines: Line[];
  text: string;
}

export interface TextBox {
  lines: Line[];
  paragraphs: Paragraph[];
  l: number;
  b: number;
  r: number;
  t: number;
  /** Size of the first line. */
  size: number;
  /** Baseline to baseline; null for a one-line box. */
  leading: number | null;
  justified: boolean;
  /** Text objects drawing the box (PDFium handles). May be shared with other boxes. */
  objects: number[];
}

interface Row {
  y: number;
  size: number;
  chars: PageChar[];
}

interface Segment {
  chars: PageChar[];
  y: number;
  size: number;
  leader: boolean;
}

function rowsOf(chars: PageChar[]): Row[] {
  const glyphs = chars.filter((c) => !c.generated && c.ch.trim() && c.obj);
  glyphs.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Row[] = [];
  for (const g of glyphs) {
    const row = rows.find((r) => Math.abs(r.y - g.y) < 0.3 * Math.max(r.size, g.size));
    if (row) row.chars.push(g);
    else rows.push({ y: g.y, size: g.size, chars: [g] });
  }
  for (const r of rows) r.chars.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => b.y - a.y);
}

/** Dot leaders: 4+ periods in a row ("Taxable interest . . . . . . 2b"). */
function leaderStarts(chars: PageChar[], j: number): boolean {
  return (
    chars[j]?.ch === "." &&
    chars[j - 1]?.ch !== "." &&
    chars.length >= j + 4 &&
    chars.slice(j, j + 4).every((c) => c.ch === ".")
  );
}

function splitRow(row: Row, rules: Rules, spaces: number[]): Line[] {
  const segs: Segment[] = [];
  let cur: Segment | null = null;
  row.chars.forEach((c, j) => {
    const prev = cur?.chars.at(-1);
    if (!cur || !prev) {
      cur = { chars: [c], y: row.y, size: c.size, leader: leaderStarts(row.chars, j) };
      segs.push(cur);
      return;
    }
    const gap = c.l - prev.r;
    const em = Math.max(c.size, prev.size);
    const ruled = rules.v.some(
      (v) => v.x > prev.r - 0.5 && v.x < c.l + 0.5 && v.b <= row.y && v.t >= row.y,
    );
    // Leaders are their own segment, so the label stays editable on its own.
    const leader = leaderStarts(row.chars, j);
    const leaderEnds = cur.leader && prev.ch === "." && c.ch !== ".";
    if (gap > 0.9 * em || Math.abs(c.size - prev.size) > 0.5 || ruled || leader || leaderEnds) {
      // A lone list marker stays with the text after it.
      if (cur.chars.length === 1 && BULLETS.includes(prev.ch) && !ruled) {
        cur.chars.push(c);
        return;
      }
      cur = { chars: [], y: row.y, size: c.size, leader };
      segs.push(cur);
    }
    cur.chars.push(c);
  });
  const out = segs.map((s) => finishSegment(s, spaces));
  // Field rows ("Date:  February 3, 2025"): the value after a label is its own paragraph.
  out.forEach((s, i) => (s.afterLabel = i > 0 && !!out[i - 1]?.text.endsWith(":")));
  return out;
}

/** Text of a run of glyphs, with a space wherever the gap looks like a word break. */
function finishSegment(seg: Segment, spaces: number[]): Line {
  let text = "";
  const gaps: number[] = [];
  let prev: PageChar | null = null;
  for (const c of seg.chars) {
    if (prev) {
      const lo = Math.min(prev.index, c.index);
      const hi = Math.max(prev.index, c.index);
      const spaced = spaces.some((i) => i > lo && i < hi);
      if (spaced || c.l - prev.r > 0.25 * c.size) {
        text += " ";
        gaps.push(c.l - prev.r);
      }
    }
    text += c.ch;
    prev = c;
  }
  const first = seg.chars[0];
  return {
    chars: seg.chars,
    y: seg.y,
    size: seg.size,
    text,
    l: Math.min(...seg.chars.map((c) => c.l)),
    r: Math.max(...seg.chars.map((c) => c.r)),
    t: Math.max(...seg.chars.map((c) => c.t)),
    b: Math.min(...seg.chars.map((c) => c.b)),
    gap: gaps.length ? gaps.reduce((a, g) => a + g, 0) / gaps.length : null,
    font: first?.font ?? "",
    afterLabel: false,
    leader: seg.leader,
    // Typed rules and leaders stand alone: they never join a box.
    standalone: seg.leader || TYPED_RULE.test(text),
  };
}

function firstWordWidth(line: Line): number {
  const sp = line.text.indexOf(" ");
  const n = sp < 0 ? line.chars.length : sp;
  const end = line.chars[Math.min(n, line.chars.length) - 1];
  return end ? end.r - line.l : 0;
}

/** Groups a page's chars (from `pageChars`) into boxes, top to bottom. */
export function groupChars(chars: PageChar[], rules: Rules): TextBox[] {
  const spaces = chars.filter((c) => c.ch === " " || c.ch === " ").map((c) => c.index);
  const lines = rowsOf(chars).flatMap((r) => splitRow(r, rules, spaces));
  lines.sort((a, b) => b.y - a.y || a.l - b.l);
  // A typed rule separates the boxes above and below it, like a drawn one.
  const boxRules = [
    ...rules.h,
    ...lines
      .filter((x) => x.standalone && !x.leader)
      .map((x) => ({ l: x.l, r: x.r, y: (x.t + x.b) / 2 })),
  ];

  const open: { lines: Line[]; leading: number | null }[] = [];
  for (const line of lines) {
    const box = line.standalone
      ? undefined
      : open.find((bx) => {
          const last = bx.lines.at(-1);
          if (!last || last.standalone) return false;
          if (Math.abs(last.size - line.size) > 0.5) return false;
          if (Math.abs(last.l - line.l) > 1.5) return false;
          const lead = last.y - line.y;
          if (lead <= 0) return false;
          if (bx.leading !== null) {
            if (Math.abs(lead - bx.leading) > 0.15 * bx.leading) return false;
          } else if (lead > 1.6 * line.size) return false;
          return !boxRules.some(
            (h) =>
              h.y < last.b &&
              h.y > line.t &&
              h.l < Math.max(last.r, line.r) &&
              h.r > Math.min(last.l, line.l),
          );
        });
    if (box) {
      const last = box.lines.at(-1);
      if (box.leading === null && last) box.leading = last.y - line.y;
      box.lines.push(line);
    } else open.push({ lines: [line], leading: null });
  }
  return open.map(({ lines: ls, leading }) => finishBox(ls, leading));
}

function finishBox(lines: Line[], leading: number | null): TextBox {
  const l = Math.min(...lines.map((x) => x.l));
  const r = Math.max(...lines.map((x) => x.r));
  const width = r - l;
  const paragraphs: Paragraph[] = [];
  let para: Paragraph | null = null;
  lines.forEach((line, i) => {
    const prev = lines[i - 1];
    const brk =
      !prev ||
      r - prev.r > firstWordWidth(line) + 0.3 * line.size ||
      prev.r - prev.l < 0.6 * width ||
      prev.text.endsWith(":") ||
      line.afterLabel ||
      BULLETS.includes(line.chars[0]?.ch ?? "") ||
      AMOUNT.test(line.text) ||
      AMOUNT.test(prev.text);
    if (brk || !para) {
      para = { lines: [], text: "" };
      paragraphs.push(para);
    }
    para.lines.push(line);
  });
  for (const p of paragraphs) p.text = p.lines.map((x) => x.text).join(" ");
  // Justified: every line but the last reaches the right edge AND the word spacing
  // differs between lines (ragged text that happens to line up has equal spacing).
  const body = lines.slice(0, -1);
  const gaps = body.map((x) => x.gap).filter((g): g is number => g !== null);
  const size = lines[0]?.size ?? 0;
  const justified =
    body.length >= 2 &&
    body.every((x) => Math.abs(r - x.r) < 1.5) &&
    gaps.length >= 2 &&
    Math.max(...gaps) - Math.min(...gaps) > 0.015 * size;
  return {
    lines,
    paragraphs,
    l,
    r,
    t: Math.max(...lines.map((x) => x.t)),
    b: Math.min(...lines.map((x) => x.b)),
    size,
    leading,
    justified,
    objects: [...new Set(lines.flatMap((x) => x.chars.map((c) => c.obj)))],
  };
}
