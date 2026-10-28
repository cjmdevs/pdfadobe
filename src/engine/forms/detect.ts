// Prepare Form > Detect fields (Phase 6): likely fields on a flat page, found from what
// the page draws, not from a model:
//   - runs of 3+ underscores ("Name: ________") and free-standing horizontal lines
//     become text fields sitting on them;
//   - small square boxes (6-16 pt) become check boxes;
//   - larger empty rectangles become text fields (multiline when tall).
// Each is named from the label to its left on the same line, or just above it.
// Candidates over existing fields or over each other are dropped. Node-safe; the
// geometry part (`findCandidates`) is plain data so it is tested without PDFium.

import type { PdfiumModule } from "../pdfium";
import { RawDoc } from "../pages/raw";
import { objBounds, pageChars, pageRules, type PageChar, type Rect } from "../edit/chars";
import type { NewFieldKind, PdfRect } from "./design";

export interface FieldCandidate {
  kind: Extract<NewFieldKind, "text" | "checkbox">;
  pageIndex: number;
  rect: PdfRect;
  /** Suggested field name (the label), unique in the document. */
  name: string;
  multiline?: boolean;
}

export interface PageGeometry {
  chars: PageChar[];
  /** Horizontal rules: l, r, y. */
  lines: { l: number; r: number; y: number }[];
  /** Closed rectangles drawn as one path. */
  boxes: Rect[];
  /** Widgets already on the page. */
  widgets: Rect[];
}

const FIELD_H = 16;

const overlap = (a: PdfRect, b: PdfRect) => {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.t, b.t) - Math.max(a.b, b.b);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min((a.r - a.l) * (a.t - a.b), (b.r - b.l) * (b.t - b.b));
};

const visible = (c: PageChar) => !c.generated && c.ch.trim() !== "";

const clean = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:.#*]+$/, "")
    .replace(/[^\p{L}\p{N} '&/-]/gu, "")
    .trim()
    .slice(0, 60);

/** The words right of a check box on its line, up to the first wide gap. */
export function labelRightOf(chars: PageChar[], r: PdfRect): string {
  const mid = (r.b + r.t) / 2;
  const line = chars
    .filter(
      (c) => !c.generated && c.l >= r.r - 2 && c.l <= r.r + 220 && c.b <= mid + 6 && c.t >= mid - 6,
    )
    .sort((a, b) => a.l - b.l);
  let end = line.length;
  for (let i = 1; i < line.length; i++) {
    const cur = line[i];
    const prev = line[i - 1];
    if (cur && prev && cur.l - prev.r > Math.max(12, (cur.size || 10) * 1.5)) {
      end = i;
      break;
    }
  }
  const first = line[0];
  // The label must start right next to the box, not be some text further along.
  if (!first || first.l - r.r > 24) return "";
  return clean(
    line
      .slice(0, end)
      .map((c) => c.ch)
      .join(""),
  );
}

/** Text of the label left of `r` on its line (or the line just above), cleaned up. */
export function labelFor(chars: PageChar[], r: PdfRect): string {
  const mid = (r.b + r.t) / 2;
  const sameLine = chars.filter(
    (c) =>
      !c.generated &&
      c.ch !== "_" &&
      c.r <= r.l + 2 &&
      c.l >= r.l - 260 &&
      c.b <= mid + 6 &&
      c.t >= mid - 6,
  );
  let picked = sameLine;
  if (!picked.some(visible)) {
    // Nothing to the left: the nearest line above, over the field's left part.
    const above = chars.filter(
      (c) =>
        !c.generated && c.b >= r.t - 2 && c.b <= r.t + 16 && c.r >= r.l - 4 && c.l <= r.l + 200,
    );
    const nearest = Math.min(...above.map((c) => c.b));
    picked = above.filter((c) => Math.abs(c.b - nearest) < 3);
  }
  // Only the words closest to the field: stop at a wide gap going left.
  const sorted = [...picked].sort((a, b) => a.l - b.l);
  let start = 0;
  for (let i = sorted.length - 1; i > 0; i--) {
    const cur = sorted[i];
    const prev = sorted[i - 1];
    if (cur && prev && cur.l - prev.r > Math.max(12, (cur.size || 10) * 1.5)) {
      start = i;
      break;
    }
  }
  return clean(
    sorted
      .slice(start)
      .map((c) => c.ch)
      .join(""),
  );
}

/** Candidates on one page, before naming. */
export function findCandidates(g: PageGeometry, pageIndex: number): Omit<FieldCandidate, "name">[] {
  const out: Omit<FieldCandidate, "name">[] = [];
  const add = (c: Omit<FieldCandidate, "name">) => {
    if (g.widgets.some((w) => overlap(w, c.rect) > 0.3)) return;
    if (out.some((o) => overlap(o.rect, c.rect) > 0.3)) return;
    out.push(c);
  };

  // 1. Underscore runs drawn as text.
  const chars = [...g.chars].sort((a, b) => b.y - a.y || a.l - b.l);
  for (let i = 0; i < chars.length; i++) {
    const first = chars[i];
    if (first?.ch !== "_") continue;
    let last = first;
    let j = i;
    for (
      let next = chars[j + 1];
      next?.ch === "_" && Math.abs(next.y - first.y) < 1;
      next = chars[j + 1]
    ) {
      last = next;
      j++;
    }
    if (j - i + 1 >= 3) {
      add({
        kind: "text",
        pageIndex,
        rect: { l: first.l, b: first.y - 2, r: last.r, t: first.y - 2 + FIELD_H },
      });
    }
    i = j;
  }

  // 2. Small squares: check boxes. Larger empty rectangles: text fields.
  for (const b of g.boxes) {
    const w = b.r - b.l;
    const h = b.t - b.b;
    const holdsText = g.chars.some(
      (c) => visible(c) && c.l >= b.l - 1 && c.r <= b.r + 1 && c.b >= b.b - 1 && c.t <= b.t + 1,
    );
    if (holdsText) continue;
    if (w >= 6 && w <= 16 && h >= 6 && h <= 16 && Math.abs(w - h) <= 3)
      add({ kind: "checkbox", pageIndex, rect: { ...b } });
    else if (w >= 40 && h >= 12 && h <= 200)
      add({ kind: "text", pageIndex, rect: { ...b }, ...(h > 30 ? { multiline: true } : {}) });
  }

  // 3. Horizontal lines with nothing written on them (underlines of text are skipped).
  for (const ln of g.lines) {
    const w = ln.r - ln.l;
    if (w < 40 || w > 500) continue;
    const underlinesText = g.chars.some(
      (c) => visible(c) && c.r > ln.l && c.l < ln.r && c.y >= ln.y - 1 && c.y <= ln.y + 4,
    );
    // A side of a drawn box is not a blank to fill.
    const boxSide = g.boxes.some(
      (b) =>
        b.l <= ln.l + 2 &&
        b.r >= ln.r - 2 &&
        (Math.abs(b.b - ln.y) < 2 || Math.abs(b.t - ln.y) < 2),
    );
    if (underlinesText || boxSide) continue;
    add({
      kind: "text",
      pageIndex,
      rect: { l: ln.l, b: ln.y + 1, r: ln.r, t: ln.y + 1 + FIELD_H },
    });
  }
  return out;
}

/** Field names from labels: "Client name", unique against `taken` ("Notes 2"...). */
export function nameCandidates(
  found: Omit<FieldCandidate, "name">[],
  chars: Map<number, PageChar[]>,
  taken: Set<string>,
): FieldCandidate[] {
  const used = new Set(taken);
  return found.map((c) => {
    const page = chars.get(c.pageIndex) ?? [];
    const label =
      c.kind === "checkbox"
        ? labelRightOf(page, c.rect) || labelFor(page, c.rect)
        : labelFor(page, c.rect);
    const base = label || (c.kind === "checkbox" ? "Check Box" : "Text");
    let name = base;
    for (let k = 2; used.has(name); k++) name = `${base} ${k}`;
    used.add(name);
    return { ...c, name };
  });
}

const FPDF_PAGEOBJ_PATH = 2;
const WIDGET = 20;

/** Likely fields on every page of `bytes`, named and ready for addField. */
export function detectFields(
  m: PdfiumModule,
  bytes: Uint8Array,
  taken: Set<string>,
): FieldCandidate[] {
  const doc = RawDoc.open(m, bytes);
  const found: Omit<FieldCandidate, "name">[] = [];
  const charsByPage = new Map<number, PageChar[]>();
  try {
    for (let p = 0; p < doc.pageCount; p++) {
      doc.withPage(p, (page) => {
        const text = m.FPDFText_LoadPage(page);
        try {
          const chars = pageChars(m, text);
          charsByPage.set(p, chars);
          const boxes: Rect[] = [];
          for (let i = 0; i < m.FPDFPage_CountObjects(page); i++) {
            const obj = m.FPDFPage_GetObject(page, i);
            if (m.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_PATH) continue;
            const b = objBounds(m, obj);
            // A closed rectangle: one path with both sides longer than a rule's width.
            if (b && b.r - b.l > 4 && b.t - b.b > 4 && m.FPDFPath_CountSegments(obj) <= 6)
              boxes.push(b);
          }
          const widgets: Rect[] = [];
          for (let i = 0; i < m.FPDFPage_GetAnnotCount(page); i++) {
            const a = m.FPDFPage_GetAnnot(page, i);
            if (!a) continue;
            try {
              if (m.FPDFAnnot_GetSubtype(a) !== WIDGET) continue;
              const r = annotRect(m, a);
              if (r) widgets.push(r);
            } finally {
              m.FPDFPage_CloseAnnot(a);
            }
          }
          const lines = pageRules(m, page).h;
          found.push(...findCandidates({ chars, lines, boxes, widgets }, p));
        } finally {
          m.FPDFText_ClosePage(text);
        }
      });
    }
  } finally {
    doc.close();
  }
  return nameCandidates(found, charsByPage, taken);
}

function annotRect(m: PdfiumModule, annot: number): Rect | null {
  const p = m.pdfium.wasmExports.malloc(16);
  try {
    if (!m.FPDFAnnot_GetRect(annot, p)) return null;
    const f = (o: number) => m.pdfium.getValue(p + o, "float");
    // FS_RECTF: left, top, right, bottom.
    const [l, t, r, b] = [f(0), f(4), f(8), f(12)];
    return { l: Math.min(l, r), b: Math.min(b, t), r: Math.max(l, r), t: Math.max(b, t) };
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}
