// Edit PDF (B3): move a text box without re-typesetting it. Its text objects are moved
// as they are (kerning, spacing and fonts untouched); a text object it shares with
// another box is split first (`isolateBox`). Its underlines move with it. The moved
// text is marked as one box (`marks.ts`), so it stays one box wherever it lands.
//
// Pushing down: when an edit makes a box taller, the boxes below it in the same column
// can be moved down by the same amount (Acrobat only warns; this is the option).

import type { PdfiumModule } from "../pdfium";
import type { PageChar, Rules } from "./chars";
import { groupChars, type TextBox } from "./group";
import { nextBoxId, setBoxId } from "./marks";
import { underlinesOf } from "./retypeset";
import { isolateBox } from "./split";
import { pageChars, pageRules } from "./chars";

/** Moves `box` by (dx, dy) points. The page content still needs FPDFPage_GenerateContent. */
export function moveBoxText(
  m: PdfiumModule,
  doc: number,
  page: number,
  box: TextBox,
  chars: PageChar[],
  rules: Rules,
  dx: number,
  dy: number,
): void {
  const { objects, removal } = isolateBox(m, doc, page, box, chars);
  const id = box.id ?? nextBoxId(m, page);
  for (const o of objects) {
    m.FPDFPageObj_Transform(o, 1, 0, 0, 1, dx, dy);
    setBoxId(m, doc, o, id);
  }
  for (const h of underlinesOf(box, rules))
    if (h.obj !== undefined) m.FPDFPageObj_Transform(h.obj, 1, 0, 0, 1, dx, dy);
  removal.commit();
}

/** The page's chars, rules and boxes as they are now. */
export function groupNow(m: PdfiumModule, page: number) {
  const tp = m.FPDFText_LoadPage(page);
  const chars = pageChars(m, tp);
  m.FPDFText_ClosePage(tp);
  const rules = pageRules(m, page);
  return { chars, rules, boxes: groupChars(chars, rules) };
}

/**
 * Boxes below `under` (a box's old outline) whose columns overlap it, nearest first:
 * what grows into them when that box gets taller.
 */
export function boxesBelow(
  under: { l: number; r: number; b: number },
  boxes: TextBox[],
  skip: TextBox,
): TextBox[] {
  const out: TextBox[] = [];
  let span = { l: under.l, r: under.r };
  const below = boxes.filter((b) => b !== skip && b.t <= under.b + 0.5).sort((a, b) => b.t - a.t);
  // A box pushed down pushes the boxes under it too (its column joins the span).
  for (const b of below) {
    if (b.l < span.r && b.r > span.l) {
      out.push(b);
      span = { l: Math.min(span.l, b.l), r: Math.max(span.r, b.r) };
    }
  }
  return out;
}

const key = (b: TextBox) => ({
  preview: (b.paragraphs[0]?.text ?? "").slice(0, 60),
  l: b.l,
  t: b.t,
});

/**
 * Moves `targets` down by `by` points, one at a time (each move can rewrite shared
 * objects, so the page is grouped again in between). Returns how many end up partly
 * below the page's bottom edge.
 */
export function pushDown(
  m: PdfiumModule,
  doc: number,
  page: number,
  targets: TextBox[],
  by: number,
): number {
  let off = 0;
  for (const k of targets.map(key)) {
    const g = groupNow(m, page);
    const b = g.boxes.find(
      (x) =>
        (x.paragraphs[0]?.text ?? "").slice(0, 60) === k.preview &&
        Math.abs(x.l - k.l) < 0.5 &&
        Math.abs(x.t - k.t) < 0.5,
    );
    if (!b) continue;
    moveBoxText(m, doc, page, b, g.chars, g.rules, 0, -by);
    if (b.b - by < 0) off++;
  }
  return off;
}
