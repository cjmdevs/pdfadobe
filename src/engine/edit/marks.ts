// Edit PDF (B3): box ids kept in the PDF as marked content. Every text object we write
// for a box is wrapped in `/PWBox <</id N>> BDC ... EMC` (standard marked content,
// PDF 32000 14.6; other viewers ignore a tag they don't know). Grouping keeps the
// lines of one id in one box and never mixes ids, so a Join or Split survives saving
// and reopening, whatever the geometry says.

import type { PdfiumModule } from "../pdfium";

export const BOX_MARK = "PWBox";

/**
 * Spacing PDFium can't write (it has no setters): carried on the object's mark until
 * the content-stream pass (`spacing.ts`) writes it as Tc and a TJ array, then dropped.
 */
export interface Spacing {
  /** Character spacing (Tc), text space units. */
  tc: number;
  /** Letters in the object (codes in its string). */
  n: number;
  /** TJ adjustments: after letter i, thousandths of an em (negative: wider). */
  adjust: [number, number][];
}

/**
 * The spacing settings an object was written with (character and word spacing in
 * thousandths of an em, horizontal scale in percent, kerning on), kept on its mark so
 * the Format panel can show them again: PDFium can't read them back from the text.
 */
export interface Look {
  charSpacing?: number;
  wordSpacing?: number;
  hScale?: number;
  kerning?: boolean;
  /** The paragraph's line spacing and space after (points): a one-line paragraph has
   * no second baseline to measure, and the space after the last one shows nowhere. */
  leading?: number;
  spaceAfter?: number;
}

const LOOK_KEYS = {
  charSpacing: "cs",
  wordSpacing: "ws",
  hScale: "hs",
  leading: "ld",
  spaceAfter: "sa",
} as const;

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

/** Marks `obj` as part of box `id` (replacing an earlier box id), with its spacing. */
export function setBoxId(
  m: PdfiumModule,
  doc: number,
  obj: number,
  id: number,
  spacing?: Spacing,
  look?: Look,
): void {
  const keep = look ?? lookOf(m, obj);
  clearBoxId(m, obj);
  const mark = m.FPDFPageObj_AddMark(obj, BOX_MARK);
  if (!mark || !m.FPDFPageObjMark_SetIntParam(doc, obj, mark, "id", id))
    throw new Error("PDFium could not mark the text box");
  for (const [k, key] of Object.entries(LOOK_KEYS) as [keyof typeof LOOK_KEYS, string][]) {
    const v = keep[k];
    if (v !== undefined && v !== (k === "hScale" ? 100 : 0))
      m.FPDFPageObjMark_SetFloatParam(doc, obj, mark, key, v);
  }
  if (keep.kerning) m.FPDFPageObjMark_SetIntParam(doc, obj, mark, "kn", 1);
  if (!spacing) return;
  const ok =
    m.FPDFPageObjMark_SetFloatParam(doc, obj, mark, "Tc", spacing.tc) &&
    m.FPDFPageObjMark_SetIntParam(doc, obj, mark, "N", spacing.n) &&
    m.FPDFPageObjMark_SetStringParam(
      doc,
      obj,
      mark,
      "K",
      spacing.adjust.map(([i, v]) => `${i}:${v}`).join(","),
    );
  if (!ok) throw new Error("PDFium could not mark the text spacing");
}

/** The spacing settings on an object's mark (none: plain). */
export function lookOf(m: PdfiumModule, obj: number): Look {
  const ex = m.pdfium.wasmExports;
  const name = ex.malloc(64);
  const len = ex.malloc(4);
  const val = ex.malloc(8);
  try {
    for (let i = 0; i < m.FPDFPageObj_CountMarks(obj); i++) {
      const mark = m.FPDFPageObj_GetMark(obj, i);
      if (!mark || !m.FPDFPageObjMark_GetName(mark, name, 64, len)) continue;
      if (m.pdfium.UTF16ToString(name) !== BOX_MARK) continue;
      const out: Look = {};
      for (const [k, key] of Object.entries(LOOK_KEYS) as [keyof typeof LOOK_KEYS, string][])
        if (m.FPDFPageObjMark_GetParamFloatValue(mark, key, val))
          out[k] = Math.round(m.pdfium.getValue(val, "float") * 100) / 100;
      if (m.FPDFPageObjMark_GetParamIntValue(mark, "kn", val)) out.kerning = true;
      return out;
    }
    return {};
  } finally {
    for (const p of [name, len, val]) ex.free(p);
  }
}

/** The spacing still waiting on an object's mark (to keep it when its id changes). */
export function spacingOf(m: PdfiumModule, obj: number): Spacing | undefined {
  const ex = m.pdfium.wasmExports;
  const name = ex.malloc(64);
  const len = ex.malloc(4);
  const val = ex.malloc(8);
  const buf = ex.malloc(4096);
  try {
    for (let i = 0; i < m.FPDFPageObj_CountMarks(obj); i++) {
      const mark = m.FPDFPageObj_GetMark(obj, i);
      if (!mark || !m.FPDFPageObjMark_GetName(mark, name, 64, len)) continue;
      if (m.pdfium.UTF16ToString(name) !== BOX_MARK) continue;
      if (!m.FPDFPageObjMark_GetParamIntValue(mark, "N", val)) return undefined;
      const n = m.pdfium.getValue(val, "i32");
      const tc = m.FPDFPageObjMark_GetParamFloatValue(mark, "Tc", val)
        ? m.pdfium.getValue(val, "float")
        : 0;
      const k: string = m.FPDFPageObjMark_GetParamStringValue(mark, "K", buf, 4096, len)
        ? String(m.pdfium.UTF16ToString(buf))
        : "";
      const adjust = k
        .split(",")
        .map((pair: string) => pair.split(":").map(Number))
        .filter((x: number[]): x is [number, number] => x.length === 2 && x.every(Number.isFinite));
      return { tc, n, adjust };
    }
    return undefined;
  } finally {
    for (const p of [name, len, val, buf]) ex.free(p);
  }
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
