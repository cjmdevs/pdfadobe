// Edit PDF (B3 stage 2): drawing order (Arrange). Objects later in a page's content
// are drawn on top. A group (an image, or a text box's objects) keeps its own order
// and moves as one:
//   front / back       to the end / start of the page's objects
//   forward / backward past the next object above / below that overlaps it
// The page content still needs FPDFPage_GenerateContent.

import type { PdfiumModule } from "../pdfium";
import { objBounds, type Rect } from "./chars";

export type Arrange = "front" | "back" | "forward" | "backward";

const hits = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.b < b.t && a.t > b.b;

/** Moves the objects `group` in the page's drawing order. */
export function arrange(m: PdfiumModule, page: number, group: number[], how: Arrange): void {
  const all = Array.from({ length: m.FPDFPage_CountObjects(page) }, (_, i) =>
    m.FPDFPage_GetObject(page, i),
  );
  const mine = new Set(group);
  const inGroup = all.filter((o) => mine.has(o));
  if (!inGroup.length) return;
  const rest = all.filter((o) => !mine.has(o));
  const boxes = inGroup.map((o) => objBounds(m, o)).filter((r): r is Rect => r !== null);
  const over = (o: number) => {
    const r = objBounds(m, o);
    return !!r && boxes.some((b) => hits(b, r));
  };
  const first = all.indexOf(inGroup[0] ?? 0);
  const last = all.indexOf(inGroup.at(-1) ?? 0);
  // Where the group goes in `rest` (the page without it).
  let at: number;
  if (how === "front") at = rest.length;
  else if (how === "back") at = 0;
  else if (how === "forward") {
    const next = all.slice(last + 1).find((o) => !mine.has(o) && over(o));
    if (next === undefined) return;
    at = rest.indexOf(next) + 1;
  } else {
    const prev = all
      .slice(0, first)
      .reverse()
      .find((o) => !mine.has(o) && over(o));
    if (prev === undefined) return;
    at = rest.indexOf(prev);
  }
  const order = [...rest.slice(0, at), ...inGroup, ...rest.slice(at)];
  if (order.every((o, i) => o === all[i])) return;
  // Take the group off and put it back at its new place, in its own order.
  for (const o of inGroup) m.FPDFPage_RemoveObject(page, o);
  inGroup.forEach((o, k) => {
    if (!m.FPDFPage_InsertObjectAtIndex(page, o, at + k))
      throw new Error("PDFium could not reorder the page");
  });
}
