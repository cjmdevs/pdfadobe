// Edit PDF (B3): remove a box's text without touching any other box. Tax software
// often draws a whole row in one Tj ("FIRST SAMPLE BANK          812."), so the
// description box and the amount box share one text object. The parts of each shared
// object that belong to OTHER boxes are rewritten as new objects first.
//
// PDFium has no char-code getter, so the leftover text is written back with
// FPDFText_SetText and every glyph is checked against where it was. The check runs
// with the originals off the page: PDFium's text page drops a glyph drawn exactly on
// top of an identical one (its fake-bold handling). A run that does not land exactly
// (Tc/Tw/TJ spacing) is rewritten one object per glyph; if that also fails, the edit
// is refused and the page is put back as it was.

import type { PdfiumModule } from "../pdfium";
import type { PageChar } from "./chars";
import { pageChars } from "./chars";
import type { TextBox } from "./group";
import { EditRefused } from "./refusal";

/** Glyph origins must land within this many points of where they were. */
const TOLERANCE = 0.05;

interface Run {
  /** The original object it came from. */
  from: number;
  /** Glyphs (no spaces) in content order, with their original origins. */
  glyphs: PageChar[];
  /** Text to write, spaces included. */
  text: string;
}

/** A removal in progress: the originals are off the page but not yet destroyed. */
export interface Removal {
  /** Objects written for the parts of shared objects outside the box. */
  created: number[];
  /** Makes it final (destroys the originals). */
  commit(): void;
  /** Puts the page back exactly as it was. */
  rollback(): void;
}

/**
 * Takes `box`'s text objects off the page, first rewriting the parts of shared objects
 * that lie outside the box. Call `commit` or `rollback` on the result. The page content
 * still needs FPDFPage_GenerateContent. `chars` are the page's chars from the text page
 * `box` was grouped from. Throws EditRefused with the page unchanged.
 */
export function removeBoxText(
  m: PdfiumModule,
  doc: number,
  page: number,
  box: TextBox,
  chars: PageChar[],
): Removal {
  const inBox = new Set(box.lines.flatMap((l) => l.chars.map((c) => c.index)));
  const runs = box.objects.flatMap((obj) => leftoverRuns(obj, chars, inBox));
  // Drawing order of the originals, so a refusal can put them back where they were.
  const originals = box.objects
    .map((obj) => ({ obj, index: objectIndex(m, page, obj) }))
    .filter((o) => o.index >= 0)
    .sort((a, b) => a.index - b.index);

  const created: number[] = [];
  try {
    // Each copy goes where its original is, keeping the drawing order.
    const placed = runs.map((run) => ({
      run,
      obj: writeRun(m, doc, page, run, run.text, objectIndex(m, page, run.from)),
    }));
    created.push(...placed.map((p) => p.obj));
    for (const o of originals) m.FPDFPage_RemoveObject(page, o.obj);

    const landed = glyphsByObject(m, page);
    const failed = placed.filter((p) => !sameGlyphs(landed.get(p.obj) ?? [], p.run.glyphs));
    // Spacing the plain run cannot reproduce: one object per glyph, each at its origin.
    const single = failed.flatMap((p) => {
      const at = objectIndex(m, page, p.obj);
      removeObject(m, page, p.obj);
      created.splice(created.indexOf(p.obj), 1);
      return p.run.glyphs.map((g) => ({
        g,
        obj: writeRun(m, doc, page, { ...p.run, glyphs: [g] }, g.ch, at),
      }));
    });
    created.push(...single.map((s) => s.obj));
    if (single.length) {
      const again = glyphsByObject(m, page);
      if (single.some((s) => !sameGlyphs(again.get(s.obj) ?? [], [s.g]))) {
        throw new EditRefused(
          "This text is drawn together with nearby text that can't be rewritten exactly, so it can't be edited on its own.",
        );
      }
    }
    return {
      created,
      commit: () => {
        for (const o of originals) m.FPDFPageObj_Destroy(o.obj);
      },
      rollback: () => restore(m, page, created, originals),
    };
  } catch (e) {
    restore(m, page, created, originals);
    throw e;
  }
}

function restore(
  m: PdfiumModule,
  page: number,
  created: number[],
  originals: { obj: number; index: number }[],
): void {
  for (const o of created) removeObject(m, page, o);
  // Ascending drawing order puts each one back at its old index.
  for (const o of originals) {
    if (objectIndex(m, page, o.obj) < 0) m.FPDFPage_InsertObjectAtIndex(page, o.obj, o.index);
  }
}

/** Parts of `obj` outside the box, cut at line changes and at the box's own glyphs. */
function leftoverRuns(obj: number, chars: PageChar[], inBox: Set<number>): Run[] {
  const own = chars.filter((c) => c.obj === obj && !c.generated);
  const runs: Run[] = [];
  let cur: PageChar[] = [];
  const flush = () => {
    const glyphs = cur.filter((c) => c.ch.trim());
    const first = glyphs[0];
    const last = glyphs.at(-1);
    if (first && last) {
      const text = own
        .filter((c) => c.index >= first.index && c.index <= last.index)
        .map((c) => c.ch)
        .join("");
      runs.push({ from: obj, glyphs, text });
    }
    cur = [];
  };
  for (const c of own) {
    const prev = cur.filter((x) => x.ch.trim()).at(-1);
    if (inBox.has(c.index) || (prev && Math.abs(prev.y - c.y) > 0.3 * c.size)) flush();
    if (!inBox.has(c.index)) cur.push(c);
  }
  flush();
  // Only objects that really are shared have glyphs outside the box.
  return runs.length && own.some((c) => inBox.has(c.index)) ? runs : [];
}

/**
 * A copy of `run.from`'s font, size, matrix, colours and render mode holding `text`,
 * inserted at drawing position `at` (appended when negative).
 */
function writeRun(
  m: PdfiumModule,
  doc: number,
  page: number,
  run: Run,
  text: string,
  at: number,
): number {
  const src = run.from;
  const first = run.glyphs[0];
  if (!first) throw new Error("empty run");
  const ex = m.pdfium.wasmExports;
  const buf = ex.malloc(Math.max(24, (text.length + 1) * 2));
  try {
    if (!m.FPDFTextObj_GetFontSize(src, buf)) throw new Error("text object has no size");
    const size = m.pdfium.getValue(buf, "float");
    const obj = m.FPDFPageObj_CreateTextObj(doc, m.FPDFTextObj_GetFont(src), size);
    if (!obj) throw new Error("PDFium could not create a text object");
    m.pdfium.stringToUTF16(text, buf, (text.length + 1) * 2);
    if (!m.FPDFText_SetText(obj, buf)) {
      m.FPDFPageObj_Destroy(obj);
      throw new Error("PDFium could not set the text");
    }
    // Same matrix, moved to the run's first glyph (a text object's e,f is its origin).
    if (!m.FPDFPageObj_GetMatrix(src, buf)) throw new Error("text object has no matrix");
    const f = (k: number) => m.pdfium.getValue(buf + k * 4, "float");
    const [a, b, c, d] = [f(0), f(1), f(2), f(3)];
    m.pdfium.setValue(buf, a, "float");
    m.pdfium.setValue(buf + 4, b, "float");
    m.pdfium.setValue(buf + 8, c, "float");
    m.pdfium.setValue(buf + 12, d, "float");
    m.pdfium.setValue(buf + 16, first.x, "float");
    m.pdfium.setValue(buf + 20, first.y, "float");
    m.FPDFPageObj_SetMatrix(obj, buf);
    copyColours(m, src, obj, buf);
    m.FPDFTextObj_SetTextRenderMode(obj, m.FPDFTextObj_GetTextRenderMode(src));
    if (at < 0 || !m.FPDFPage_InsertObjectAtIndex(page, obj, at)) {
      m.FPDFPage_InsertObject(page, obj);
    }
    return obj;
  } finally {
    ex.free(buf);
  }
}

function copyColours(m: PdfiumModule, src: number, dst: number, buf: number): void {
  const u = (k: number) => m.pdfium.getValue(buf + k * 4, "i32") >>> 0;
  if (m.FPDFPageObj_GetFillColor(src, buf, buf + 4, buf + 8, buf + 12))
    m.FPDFPageObj_SetFillColor(dst, u(0), u(1), u(2), u(3));
  if (m.FPDFPageObj_GetStrokeColor(src, buf, buf + 4, buf + 8, buf + 12))
    m.FPDFPageObj_SetStrokeColor(dst, u(0), u(1), u(2), u(3));
}

function objectIndex(m: PdfiumModule, page: number, obj: number): number {
  const n = m.FPDFPage_CountObjects(page);
  for (let i = 0; i < n; i++) if (m.FPDFPage_GetObject(page, i) === obj) return i;
  return -1;
}

function removeObject(m: PdfiumModule, page: number, obj: number): void {
  if (m.FPDFPage_RemoveObject(page, obj)) m.FPDFPageObj_Destroy(obj);
}

/** Glyphs (no spaces) per text object, read from a fresh text page. */
function glyphsByObject(m: PdfiumModule, page: number): Map<number, PageChar[]> {
  const tp = m.FPDFText_LoadPage(page);
  try {
    const out = new Map<number, PageChar[]>();
    for (const c of pageChars(m, tp)) {
      if (c.generated || !c.ch.trim()) continue;
      const list = out.get(c.obj) ?? [];
      list.push(c);
      out.set(c.obj, list);
    }
    return out;
  } finally {
    m.FPDFText_ClosePage(tp);
  }
}

function sameGlyphs(got: PageChar[], want: PageChar[]): boolean {
  return (
    got.length === want.length &&
    got.every((g, i) => {
      const w = want[i];
      return (
        !!w && g.ch === w.ch && Math.abs(g.x - w.x) < TOLERANCE && Math.abs(g.y - w.y) < TOLERANCE
      );
    })
  );
}
