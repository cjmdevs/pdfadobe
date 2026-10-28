// Edit PDF (B3): box ids kept in the PDF as marked content. Every text object we write
// for a box is wrapped in `/PWBox <</id N>> BDC ... EMC` (standard marked content,
// PDF 32000 14.6; other viewers ignore a tag they don't know). Grouping keeps the
// lines of one id in one box and never mixes ids, so a Join or Split survives saving
// and reopening, whatever the geometry says.

import type { PdfiumModule } from "../pdfium";

export const BOX_MARK = "PWBox";

/** The box id on a page object, or null. */
export function boxIdOf(m: PdfiumModule, obj: number): number | null {
  const n = m.FPDFPageObj_CountMarks(obj);
  if (n <= 0) return null;
  const ex = m.pdfium.wasmExports;
  const name = ex.malloc(64);
  const len = ex.malloc(4);
  const val = ex.malloc(4);
  try {
    for (let i = 0; i < n; i++) {
      const mark = m.FPDFPageObj_GetMark(obj, i);
      if (!mark || !m.FPDFPageObjMark_GetName(mark, name, 64, len)) continue;
      if (m.pdfium.UTF16ToString(name) !== BOX_MARK) continue;
      if (m.FPDFPageObjMark_GetParamIntValue(mark, "id", val)) return m.pdfium.getValue(val, "i32");
    }
    return null;
  } finally {
    for (const p of [name, len, val]) ex.free(p);
  }
}

/** Marks `obj` as part of box `id` (replacing an earlier box id). */
export function setBoxId(m: PdfiumModule, doc: number, obj: number, id: number): void {
  clearBoxId(m, obj);
  const mark = m.FPDFPageObj_AddMark(obj, BOX_MARK);
  if (!mark || !m.FPDFPageObjMark_SetIntParam(doc, obj, mark, "id", id))
    throw new Error("PDFium could not mark the text box");
}

function clearBoxId(m: PdfiumModule, obj: number): void {
  const ex = m.pdfium.wasmExports;
  const name = ex.malloc(64);
  const len = ex.malloc(4);
  try {
    for (let i = m.FPDFPageObj_CountMarks(obj) - 1; i >= 0; i--) {
      const mark = m.FPDFPageObj_GetMark(obj, i);
      if (
        mark &&
        m.FPDFPageObjMark_GetName(mark, name, 64, len) &&
        m.pdfium.UTF16ToString(name) === BOX_MARK
      )
        m.FPDFPageObj_RemoveMark(obj, mark);
    }
  } finally {
    ex.free(name);
    ex.free(len);
  }
}

/** An id no object on the page uses yet. */
export function nextBoxId(m: PdfiumModule, page: number): number {
  let max = 0;
  const n = m.FPDFPage_CountObjects(page);
  for (let i = 0; i < n; i++) max = Math.max(max, boxIdOf(m, m.FPDFPage_GetObject(page, i)) ?? 0);
  return max + 1;
}
