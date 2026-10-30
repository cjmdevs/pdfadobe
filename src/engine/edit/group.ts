// Edit PDF (B3): group a page's characters into text boxes and paragraphs, the way
// Acrobat's Edit PDF shows one box per paragraph, column or cell. Pure: works on the
// plain data from `chars.ts`, so it runs (and is tested) without PDFium.
//
// Signals, in order:
//   - rows: chars within 0.3 em of the same baseline; a smaller run raised or lowered
//     next to a row's text (a footnote mark) joins that row as a script
//   - segments: a row is cut at a gap over 0.9 em, a vertical rule, where dot leaders
//     start or end, or at a size change (over 25%, or with a word gap). A list marker
//     ("•", "1.", "(a)") stays with the text after it
//   - boxes: a segment joins the box above when the size matches, no rule (drawn or
//     typed) lies between them, the line spacing matches, and the lines line up: same
//     left edge, a first-line indent, a hanging indent after a list marker, the next
//     item of the same list, or (for centred / right-aligned blocks) the same centre
//     or right edge. List items may have space between them; wrapped prose may be
//     double spaced
//   - paragraphs inside a box: a new one starts when the line above had room for the
//     next line's first word, is under 60% of the box width, ends with ":", is a value
//     after a label, starts with a list marker, or either line is only an amount;
//     in a centred or right-aligned box every line is its own paragraph
//
// Tuned on the synthetic corpus in tests/corpus/edit/ (docs/edit-spike-report.md).

import type { PageChar, Rules } from "./chars";

const BULLETS = "•▪●◦‣–-";
/** Numbered list markers: "1.", "12)", "a.", "(iv)". */
const NUMBERED = /^(\(?(\d{1,3}|[a-zA-Z]|[ivxlcIVXLC]{1,5})[.)])$/;
/** "-----", "=====" lines in typed (Courier) statements act like drawn rules. */
const TYPED_RULE = /^[-=_]{5,}$/;
/** A line that is only an amount ("1,234.", "$ 812", "(45)", "12%"). */
const AMOUNT = /^\$?\s?\(?-?\d[\d,]*\.?\d*\)?%?$/;

export type BoxAlign = "left" | "center" | "right";

export interface Line {
  chars: PageChar[];
  /** Baseline. */
  y: number;
  /** Most common size of the line's (non-script) chars. */
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
  /** A list marker the line starts with ("•", "1."), or null. */
  marker: string | null;
  /** Where the text after the marker starts (`l` without a marker). */
  textL: number;
  /** The only segment on its row (prose, not a form row with leaders or columns). */
  alone: boolean;
  /** Box id from our marked content, or null. */
  box: number | null;
}

export interface Paragraph {
  lines: Line[];
  text: string;
  /** Start of the first line's text (after its marker). */
  firstL: number;
  /** Left edge of the other lines (`firstL` for a one-line paragraph in a plain box). */
  bodyL: number;
  /** The list marker the paragraph starts with, drawn at `lines[0].l`. */
  marker: string | null;
  /** Extra space above the paragraph, beyond the box's line spacing (points, >= 0). */
  spaceBefore: number;
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
  /** Baseline to baseline inside a paragraph; null for a one-line box. */
  leading: number | null;
  justified: boolean;
  align: BoxAlign;
  /** Box id from our marked content (text we wrote as one box), or null. */
  id: number | null;
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
  leader: boolean;
}

/** Chars raised or lowered into a row (footnote marks): they never cut a segment. */
type Scripts = Set<PageChar>;

function rowsOf(chars: PageChar[], scripts: Scripts): Row[] {
  const glyphs = chars.filter((c) => !c.generated && c.ch.trim() && c.obj);
  glyphs.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Row[] = [];
  for (const g of glyphs) {
    // Text we wrote as different boxes never shares a row (a box moved over another).
    const row = rows.find(
      (r) =>
        Math.abs(r.y - g.y) < 0.3 * Math.max(r.size, g.size) &&
        (r.chars[0]?.box ?? null) === (g.box ?? null),
    );
    if (row) row.chars.push(g);
    else rows.push({ y: g.y, size: g.size, chars: [g] });
  }
  for (const r of rows) r.chars.sort((a, b) => a.x - b.x);
  // A run of small chars just above or below a bigger row, touching its text, is a
  // superscript / subscript of that row.
  for (const small of [...rows]) {
    const host = rows.find(
      (r) =>
        r !== small &&
        small.size < 0.8 * r.size &&
        Math.abs(r.y - small.y) < 0.55 * r.size &&
        small.chars.every((c) =>
          r.chars.some(
            (h) => Math.abs(c.l - h.r) < 0.5 * r.size || Math.abs(h.l - c.r) < 0.5 * r.size,
          ),
        ),
    );
    if (!host) continue;
    for (const c of small.chars) scripts.add(c);
    host.chars.push(...small.chars);
    host.chars.sort((a, b) => a.x - b.x);
    rows.splice(rows.indexOf(small), 1);
  }
  // Small chars a little off the row's baseline that landed in the row itself.
  for (const r of rows) {
    const main = mainSize(r.chars, scripts);
    const base = r.chars.find((c) => Math.abs(c.size - main) < 0.01)?.y ?? r.y;
    r.y = base;
    for (const c of r.chars)
      if (c.size < 0.8 * main && Math.abs(c.y - base) > 0.1 * main) scripts.add(c);
    r.size = main;
  }
  // Rows that now share a baseline are one row (a raised mark first seeded its own).
  rows.sort((a, b) => b.y - a.y);
  const merged: Row[] = [];
  for (const r of rows) {
    const prev = merged.at(-1);
    if (
      prev &&
      Math.abs(prev.y - r.y) < 0.3 * Math.max(prev.size, r.size) &&
      (prev.chars[0]?.box ?? null) === (r.chars[0]?.box ?? null)
    ) {
      prev.chars.push(...r.chars);
      prev.chars.sort((a, b) => a.x - b.x);
    } else merged.push(r);
  }
  return merged;
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

/** Bullets by their glyph; every number style counts as one kind. */
const markerKind = (s: string | null) => (s && NUMBERED.test(s) ? "#" : s);

const isMarker = (s: string) => (s.length === 1 && BULLETS.includes(s)) || NUMBERED.test(s);

function splitRow(row: Row, rules: Rules, spaces: number[], scripts: Scripts): Line[] {
  const segs: Segment[] = [];
  let cur: Segment | null = null;
  // The last non-script char of the segment (scripts don't set the size).
  let body: PageChar | null = null;
  row.chars.forEach((c, j) => {
    const prev = cur?.chars.at(-1);
    if (!cur || !prev) {
      cur = { chars: [c], y: row.y, leader: leaderStarts(row.chars, j) };
      segs.push(cur);
      body = scripts.has(c) ? null : c;
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
    // Two boxes we wrote never share a line.
    const otherBox = (c.box ?? null) !== (prev.box ?? null);
    const ref: PageChar | null = body;
    // Text we wrote as one box keeps mixed sizes on one line.
    const resized =
      !scripts.has(c) &&
      (c.box ?? null) === null &&
      ref !== null &&
      (Math.max(c.size, ref.size) > 1.25 * Math.min(c.size, ref.size) ||
        (Math.abs(c.size - ref.size) > 0.5 && gap > 0.4 * em));
    if (gap > 0.9 * em || resized || ruled || leader || leaderEnds || otherBox) {
      // A list marker ("•", "1.") stays with the text after it, even across a tab.
      const marker = cur.chars.map((x) => x.ch).join("");
      if (!ruled && !leader && !otherBox && isMarker(marker) && gap < 4 * em) {
        cur.chars.push(c);
        if (!scripts.has(c)) body = c;
        return;
      }
      cur = { chars: [], y: row.y, leader };
      segs.push(cur);
    }
    cur.chars.push(c);
    if (!scripts.has(c)) body = c;
  });
  const out = segs.map((s) => finishSegment(s, spaces, scripts));
  // Field rows ("Date:  February 3, 2025"): the value after a label is its own paragraph.
  out.forEach((s, i) => {
    s.afterLabel = i > 0 && !!out[i - 1]?.text.endsWith(":");
    s.alone = out.length === 1;
  });
  return out;
}

/** The most common size among `chars`, scripts left out when there are others. */
function mainSize(chars: PageChar[], scripts: Scripts): number {
  const own = chars.filter((c) => !scripts.has(c));
  const counts = new Map<number, number>();
  for (const c of own.length ? own : chars) {
    const k = Math.round(c.size * 100) / 100;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

/** Text of a run of glyphs, with a space wherever the gap looks like a word break. */
function finishSegment(seg: Segment, spaces: number[], scripts: Scripts): Line {
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
  // The marker is the first word when it looks like one and more text follows.
  const word = text.split(" ")[0] ?? "";
  // A bullet set tight against its text ("•Sign") is a marker too; a tight dash is not.
  const marker =
    word !== text && isMarker(word)
      ? word
      : first && "•▪●◦‣".includes(first.ch) && seg.chars.length > 1
        ? first.ch
        : null;
  const textL = marker ? (seg.chars[[...marker].length]?.l ?? first?.l ?? 0) : (first?.l ?? 0);
  return {
    chars: seg.chars,
    y: seg.y,
    size: mainSize(seg.chars, scripts),
    text,
    l: Math.min(...seg.chars.map((c) => c.l)),
    r: Math.max(...seg.chars.map((c) => c.r)),
    t: Math.max(...seg.chars.map((c) => c.t)),
    b: Math.min(...seg.chars.map((c) => c.b)),
    // Word gaps around a marker's tab say nothing about justification.
    gap: (marker ? gaps.slice(1) : gaps).length
      ? (marker ? gaps.slice(1) : gaps).reduce((a, g) => a + g, 0) /
        (marker ? gaps.slice(1) : gaps).length
      : null,
    font: first?.font ?? "",
    afterLabel: false,
    leader: seg.leader,
    // Typed rules and leaders stand alone: they never join a box.
    standalone: seg.leader || TYPED_RULE.test(text),
    marker,
    textL,
    alone: true,
    box: first?.box ?? null,
  };
}

function firstWordWidth(line: Line): number {
  const sp = line.text.indexOf(" ");
  const n = sp < 0 ? line.chars.length : sp;
  const end = line.chars[Math.min(n, line.chars.length) - 1];
  return end ? end.r - line.l : 0;
}

/** `prev` is a wrapped line: the next line's first word would not have fitted after it. */
function full(prev: Line, next: Line, right: number): boolean {
  return right - prev.r < firstWordWidth(next) + 0.3 * next.size;
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
const centre = (x: Line) => (x.l + x.r) / 2;

interface OpenBox {
  lines: Line[];
  /** Baseline to baseline inside a paragraph, once two such lines are known. */
  leading: number | null;
  align: BoxAlign;
  /** Left edge of continuation lines, once known. */
  bodyL: number | null;
  /** Left edge of the list markers, for a list box. */
  markerL: number | null;
}

/** Whether `line` may join `bx` as its next line, and how (null: it may not). */
function joins(bx: OpenBox, line: Line, rules: Rules["h"]): Partial<OpenBox> | null {
  const last = bx.lines.at(-1);
  const first = bx.lines[0];
  if (!last || !first || last.standalone) return null;
  if (Math.abs(last.size - line.size) > 0.5) return null;
  const lead = last.y - line.y;
  if (lead <= 0) return null;
  const ruled = rules.some(
    (h) =>
      h.y < last.b &&
      h.y > line.t &&
      h.l < Math.max(last.r, line.r) &&
      h.r > Math.min(last.l, line.l),
  );
  if (ruled) return null;
  const size = line.size;
  const right = Math.max(...bx.lines.map((x) => x.r), line.r);
  const amount = AMOUNT.test(line.text) || AMOUNT.test(last.text);

  // Centred and right-aligned blocks: every line shares the centre or right edge.
  if (bx.align !== "left") {
    if (bx.leading !== null && Math.abs(lead - bx.leading) > 0.15 * bx.leading) return null;
    if (bx.leading === null && lead > 1.6 * size) return null;
    const ok = bx.align === "center" ? near(centre(line), centre(first)) : near(line.r, first.r);
    return ok ? { leading: bx.leading ?? lead } : null;
  }

  // The next item of the same list: same kind of marker at the same edge; some space
  // between items is fine (a bullet list right above a numbered one stays apart).
  if (line.marker && bx.markerL !== null) {
    if (!near(line.l, bx.markerL) || markerKind(line.marker) !== markerKind(first.marker))
      return null;
    const min = bx.leading ?? size;
    return lead >= 0.85 * min && lead <= Math.max(min, size) + size ? {} : null;
  }
  if (
    line.marker &&
    bx.lines.length === 1 &&
    last.marker &&
    near(line.l, last.l) &&
    markerKind(line.marker) === markerKind(last.marker)
  )
    return lead <= 2.2 * size ? { markerL: last.l } : null;
  if (line.marker) return null;

  // A continuation line: the spacing must match the box's (or look like wrapped text).
  if (bx.leading !== null) {
    if (Math.abs(lead - bx.leading) > 0.15 * bx.leading) return null;
  } else if (lead > 1.6 * size) {
    // Double-spaced prose: wrapped lines, alone on their rows (form rows aren't).
    const prose =
      last.alone && line.alone && last.r - last.l > 20 * size && full(last, line, right);
    if (lead > 2.4 * size || !prose) return null;
  }
  const leading = bx.leading ?? lead;

  // After a list marker: the hanging indent (or text back under the marker).
  if (last.marker && bx.bodyL === null) {
    if (near(line.l, last.textL) || near(line.l, last.l)) return { leading, bodyL: line.l };
    return null;
  }
  if (bx.bodyL !== null) {
    if (near(line.l, bx.bodyL)) return { leading };
    return null;
  }
  if (bx.lines.length === 1) {
    if (near(line.l, last.l)) return { leading, bodyL: line.l };
    // First-line indent: the indented line is wrapped prose.
    const indent = last.l - line.l;
    if (
      indent > 1.5 &&
      indent <= 4 * size &&
      last.r - last.l > 10 * size &&
      full(last, line, right)
    )
      return { leading, bodyL: line.l };
    // Centred or right-aligned lines (never amounts: a column of them stays apart).
    if (!amount && lead <= 1.6 * size && !last.marker) {
      if (near(centre(line), centre(last))) return { leading, align: "center" };
      if (near(line.r, last.r)) return { leading, align: "right" };
    }
  }
  return null;
}

/** Groups a page's chars (from `pageChars`) into boxes, top to bottom. */
export function groupChars(chars: PageChar[], rules: Rules): TextBox[] {
  const spaces = chars.filter((c) => c.ch === " " || c.ch === " ").map((c) => c.index);
  const scripts: Scripts = new Set();
  const lines = rowsOf(chars, scripts).flatMap((r) => splitRow(r, rules, spaces, scripts));
  lines.sort((a, b) => b.y - a.y || a.l - b.l);
  // A typed rule separates the boxes above and below it, like a drawn one.
  const boxRules = [
    ...rules.h,
    ...lines
      .filter((x) => x.standalone && !x.leader)
      .map((x) => ({ l: x.l, r: x.r, y: (x.t + x.b) / 2 })),
  ];

  const fresh = (line: Line): OpenBox => ({
    lines: [line],
    leading: null,
    align: "left",
    bodyL: null,
    markerL: line.marker ? line.l : null,
  });
  const open: OpenBox[] = [];
  // Text we wrote as one box (marked with its id) stays one box: its lines join in
  // order, using the usual rules only to learn the box's spacing and indents.
  const marked = new Map<number, OpenBox>();
  for (const line of lines) {
    if (line.box !== null) {
      const bx = marked.get(line.box);
      if (!bx) {
        const nb = fresh(line);
        marked.set(line.box, nb);
        open.push(nb);
        continue;
      }
      Object.assign(bx, joins(bx, line, []) ?? {});
      bx.lines.push(line);
      continue;
    }
    let joined = false;
    if (!line.standalone)
      for (const bx of open) {
        if (bx.lines[0]?.box !== null) continue;
        const how = joins(bx, line, boxRules);
        if (!how) continue;
        Object.assign(bx, how);
        bx.lines.push(line);
        joined = true;
        break;
      }
    if (!joined) open.push(fresh(line));
  }
  return open.map((bx) => finishBox(bx));
}

function finishBox({ lines, leading, align, bodyL }: OpenBox): TextBox {
  const l = Math.min(...lines.map((x) => x.l));
  const r = Math.max(...lines.map((x) => x.r));
  const width = r - l;
  const paragraphs: Paragraph[] = [];
  let para: Paragraph | null = null;
  lines.forEach((line, i) => {
    const prev = lines[i - 1];
    const brk =
      !prev ||
      align !== "left" ||
      // Space between paragraphs (boxes joined into one keep theirs).
      (leading !== null && prev.y - line.y > 1.4 * leading) ||
      r - prev.r > firstWordWidth(line) + 0.3 * line.size ||
      prev.r - prev.l < 0.6 * width ||
      prev.text.endsWith(":") ||
      line.afterLabel ||
      line.marker !== null ||
      AMOUNT.test(line.text) ||
      AMOUNT.test(prev.text);
    if (brk || !para) {
      const space = prev && leading !== null ? prev.y - line.y - leading : 0;
      para = {
        lines: [],
        text: "",
        firstL: line.textL,
        bodyL: bodyL ?? line.textL,
        marker: line.marker,
        spaceBefore: Math.max(0, Math.round(space * 100) / 100),
      };
      paragraphs.push(para);
    }
    para.lines.push(line);
  });
  for (const p of paragraphs) {
    p.text = p.lines.map((x) => x.text).join(" ");
    if (p.lines[1]) p.bodyL = p.lines[1].l;
  }
  // Justified: every line but the last reaches the right edge AND the word spacing
  // differs between lines (ragged text that happens to line up has equal spacing).
  const body = lines.slice(0, -1);
  const gaps = body.map((x) => x.gap).filter((g): g is number => g !== null);
  const size = lines[0]?.size ?? 0;
  const justified =
    align === "left" &&
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
    leading: lines.length > 1 ? leading : null,
    justified,
    align,
    id: lines[0]?.box ?? null,
    objects: [...new Set(lines.flatMap((x) => x.chars.map((c) => c.obj)))],
  };
}
