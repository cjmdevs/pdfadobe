// B3 spike step 1: group a page's characters into lines, text boxes and paragraphs,
// the way Acrobat's Edit PDF shows one box per paragraph (or per column/cell).
//
// Signals used, in order:
//   - baseline: chars within 0.3 em of the same baseline form a row
//   - row splits: a gap wider than 0.9 em, a font-size change, or a vertical rule
//     between two chars starts a new segment (table cells, form fields, columns)
//   - boxes: a segment joins the box above when the font size matches, the left
//     edges line up, the leading matches the box (or is <= 1.6 em for the 2nd line),
//     and no horizontal rule lies between them
//   - paragraph breaks inside a box: the line above had room for the next line's
//     first word, is under 60% of the box width, or ends with ':'

import { pageChars, objBounds } from "./pdfium.mjs";

const FPDF_PAGEOBJ_PATH = 2;
const BULLETS = "•▪●–-";
const TYPED_RULE = /^[-=_]{5,}$/;
// A line that is only an amount ("1,234.", "$ 812", "(45)") is never reflowed into
// the line above or below it: a column of numbers is one value per line.
const AMOUNT = /^\$?\s?\(?-?\d[\d,]*\.?\d*\)?%?$/;

export function pageRules(m, page) {
  const rules = { h: [], v: [] };
  const n = m.FPDFPage_CountObjects(page);
  for (let i = 0; i < n; i++) {
    const obj = m.FPDFPage_GetObject(page, i);
    if (m.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_PATH) continue;
    const b = objBounds(m, obj);
    if (!b) continue;
    if (b.t - b.b < 4 && b.r - b.l > 10) rules.h.push({ l: b.l, r: b.r, y: (b.t + b.b) / 2 });
    else if (b.r - b.l < 4 && b.t - b.b > 6) rules.v.push({ x: (b.l + b.r) / 2, b: b.b, t: b.t });
  }
  return rules;
}

function rowsOf(chars) {
  const spaces = new Set(chars.filter((c) => c.ch === " " || c.ch === " ").map((c) => c.i));
  const glyphs = chars.filter((c) => !c.generated && c.ch.trim() && c.obj);
  glyphs.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const g of glyphs) {
    const row = rows.find((r) => Math.abs(r.y - g.y) < 0.3 * Math.max(r.size, g.size));
    if (row) row.chars.push(g);
    else rows.push({ y: g.y, size: g.size, chars: [g] });
  }
  for (const r of rows) {
    r.chars.sort((a, b) => a.x - b.x);
    r.spaces = spaces;
  }
  return rows.sort((a, b) => b.y - a.y);
}

/** Dot leaders: 4+ periods in a row ("Taxable interest . . . . . . 2b"). */
const leaderStarts = (chars, j) =>
  chars[j].ch === "." &&
  chars[j - 1]?.ch !== "." &&
  chars.length >= j + 4 &&
  chars.slice(j, j + 4).every((c) => c.ch === ".");

function splitRow(row, rules) {
  const segs = [];
  let cur = null;
  row.chars.forEach((c, j) => {
    const prev = cur?.chars.at(-1);
    const gap = prev ? c.l - prev.r : 0;
    const em = Math.max(c.size, prev?.size ?? 0);
    const ruled =
      prev &&
      rules.v.some((v) => v.x > prev.r - 0.5 && v.x < c.l + 0.5 && v.b <= row.y && v.t >= row.y);
    // Leaders are their own segment, so the label stays editable on its own.
    const leader = prev && leaderStarts(row.chars, j);
    const leaderEnds = prev?.ch === "." && c.ch !== "." && cur.chars.length >= 4 && cur.leader;
    if (
      !cur ||
      gap > 0.9 * em ||
      Math.abs(c.size - prev.size) > 0.5 ||
      ruled ||
      leader ||
      leaderEnds
    ) {
      // A lone list marker stays with the text after it.
      if (cur && cur.chars.length === 1 && BULLETS.includes(prev.ch) && !ruled) {
        cur.chars.push(c);
        return;
      }
      cur = { chars: [], y: row.y, size: c.size, spaces: row.spaces, leader: !!leader };
      segs.push(cur);
    }
    cur.chars.push(c);
  });
  const out = segs.map(finishSegment);
  // Typed rules ("-----", "=====" in Courier statements) and leaders stand alone: they
  // never join a box, and a typed rule separates the boxes above and below it.
  for (const s of out) s.standalone = s.leader || TYPED_RULE.test(s.text);
  // Field rows ("Date:  February 3, 2025"): the value after a label is its own paragraph.
  out.forEach((s, i) => (s.afterLabel = i > 0 && out[i - 1].text.endsWith(":")));
  return out;
}

/** Text of a run of glyphs, with a space wherever the gap looks like a word break. */
function finishSegment(seg) {
  let text = "";
  const gaps = [];
  let prev = null;
  for (const c of seg.chars) {
    const spaced =
      prev && [...seg.spaces].some((i) => i > Math.min(prev.i, c.i) && i < Math.max(prev.i, c.i));
    if (prev && (spaced || c.l - prev.r > 0.25 * c.size)) {
      text += " ";
      gaps.push(c.l - prev.r);
    }
    text += c.ch;
    prev = c;
  }
  const l = Math.min(...seg.chars.map((c) => c.l));
  const r = Math.max(...seg.chars.map((c) => c.r));
  const t = Math.max(...seg.chars.map((c) => c.t));
  const b = Math.min(...seg.chars.map((c) => c.b));
  const gap = gaps.length ? gaps.reduce((a, g) => a + g, 0) / gaps.length : null;
  return { ...seg, text, l, r, t, b, gap, font: seg.chars[0].font };
}

const firstWord = (line) => {
  const sp = line.text.indexOf(" ");
  const n = sp < 0 ? line.chars.length : sp;
  const end = line.chars[Math.min(n, line.chars.length) - 1];
  return end.r - line.l;
};

export function groupPage(m, page, textPage) {
  const chars = pageChars(m, page, textPage);
  const rules = pageRules(m, page);
  const lines = rowsOf(chars).flatMap((r) => splitRow(r, rules));
  lines.sort((a, b) => b.y - a.y || a.l - b.l);
  const boxRules = [
    ...rules.h,
    ...lines
      .filter((x) => !x.leader && x.standalone)
      .map((x) => ({ l: x.l, r: x.r, y: (x.t + x.b) / 2 })),
  ];

  const boxes = [];
  for (const line of lines) {
    const box = boxes.find((bx) => {
      const last = bx.lines.at(-1);
      if (line.standalone || last.standalone) return false;
      if (Math.abs(last.size - line.size) > 0.5) return false;
      if (Math.abs(last.l - line.l) > 1.5) return false;
      const lead = last.y - line.y;
      if (lead <= 0) return false;
      if (bx.leading ? Math.abs(lead - bx.leading) > 0.15 * bx.leading : lead > 1.6 * line.size)
        return false;
      const ruled = boxRules.some(
        (h) =>
          h.y < last.b &&
          h.y > line.t &&
          h.l < Math.max(last.r, line.r) &&
          h.r > Math.min(last.l, line.l),
      );
      return !ruled;
    });
    if (box) {
      box.leading ??= box.lines.at(-1).y - line.y;
      box.lines.push(line);
    } else boxes.push({ lines: [line], leading: null });
  }

  for (const box of boxes) {
    box.l = Math.min(...box.lines.map((x) => x.l));
    box.r = Math.max(...box.lines.map((x) => x.r));
    box.t = Math.max(...box.lines.map((x) => x.t));
    box.b = Math.min(...box.lines.map((x) => x.b));
    box.size = box.lines[0].size;
    box.paragraphs = [];
    let para = null;
    box.lines.forEach((line, i) => {
      const prev = box.lines[i - 1];
      const width = box.r - box.l;
      const brk =
        !prev ||
        box.r - prev.r > firstWord(line) + 0.3 * line.size ||
        prev.r - prev.l < 0.6 * width ||
        prev.text.endsWith(":") ||
        line.afterLabel ||
        BULLETS.includes(line.chars[0].ch) ||
        AMOUNT.test(line.text) ||
        AMOUNT.test(prev.text);
      if (brk) {
        para = { lines: [] };
        box.paragraphs.push(para);
      }
      para.lines.push(line);
    });
    for (const p of box.paragraphs) p.text = p.lines.map((x) => x.text).join(" ");
    // Justified: every line but the last reaches the right edge AND the word spacing
    // differs between lines (ragged text that happens to line up has equal spacing).
    const body = box.lines.slice(0, -1);
    const gaps = body.map((x) => x.gap).filter((g) => g !== null);
    box.justified =
      body.length >= 2 &&
      body.every((x) => Math.abs(box.r - x.r) < 1.5) &&
      gaps.length >= 2 &&
      Math.max(...gaps) - Math.min(...gaps) > 0.015 * box.size;
    box.objects = [...new Set(box.lines.flatMap((x) => x.chars.map((c) => c.obj)))];
  }
  return { boxes, rules };
}

// List markers are part of the box but not of the expected text.
const norm = (s) =>
  s
    .replace(/^[•▪●]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

/** Compares found paragraphs with the generator's expected list. */
export function scoreGrouping(boxes, expected) {
  const found = boxes.flatMap((b) =>
    b.paragraphs.map((p) => ({ text: norm(p.text), lines: p.lines.length })),
  );
  // `box: true` (an address block): one box with these lines, however it splits them
  // into paragraphs (each line of an address is its own hard break).
  const foundBoxes = boxes.map((b) => ({
    text: norm(b.paragraphs.map((p) => p.text).join(" ")),
    lines: b.lines.length,
  }));
  const results = expected.map((e) => {
    const hit = (e.box ? foundBoxes : found).find((f) => f.text === norm(e.text));
    return {
      kind: e.kind,
      text: e.text,
      ok: !!hit && hit.lines === e.lines,
      lines: hit?.lines ?? null,
    };
  });
  return { ok: results.every((r) => r.ok), results, found: found.length };
}
