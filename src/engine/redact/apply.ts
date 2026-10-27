// Apply redactions to page content (Phase 5). Node-safe, direct PDFium calls.
//
// PDFium's EPDFText_RedactInQuads does the core work (checked by a probe, 2026-10-27):
// it removes text under the box (also inside form XObjects), removes vector paths fully
// under it, and overwrites image pixels under it in the image stream itself. This file
// adds what it leaves: images and shadings fully under a box are removed, paths partly
// under a box are clipped (owner choice A), and the overlay is drawn into page content.
// Annotations, form fields and document-level data are handled in `objects.ts`.
//
// Text found under the boxes is returned for the leak scan. It is never logged.

import type { PdfiumModule } from "../pdfium";
import { RawDoc } from "../pages/raw";
import { objBounds, pageChars, type Rect } from "../edit/chars";
import {
  fillOutside,
  rectInside,
  rectsOverlap,
  strokeOutside,
  type Pt,
  type StrokePiece,
  type SubPath,
} from "./clip";

export interface PageRedaction {
  pageIndex: number;
  /** PDF points, bottom-left origin. */
  rects: Rect[];
}

export interface OverlayOptions {
  /** Box fill as #RRGGBB, or null for no box (content is still removed). */
  fill: string | null;
  /** Text drawn in each box ("Redacted"); empty for none. */
  text: string;
  textColor: string;
  /** Repeat the text to fill the box instead of drawing it once, centred. */
  repeat: boolean;
}

export const DEFAULT_OVERLAY: OverlayOptions = {
  fill: "#000000",
  text: "",
  textColor: "#FFFFFF",
  repeat: false,
};

export interface ContentReport {
  /** Text that was under the boxes, per page, for the leak scan. Never logged. */
  removedText: { pageIndex: number; text: string }[];
  imagesRemoved: number;
  pathsClipped: number;
  /** Paths partly under a box that could not be clipped, so they went whole. */
  pathsRemovedWhole: { pageIndex: number; bounds: Rect; reason: string }[];
}

const OBJ_PATH = 2;
const OBJ_IMAGE = 3;
const OBJ_SHADING = 4;
const OBJ_FORM = 5;
const SEG_LINE = 0;
const SEG_BEZIER = 1;
const SEG_MOVE = 2;
const FILL_ALTERNATE = 1;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `inner` then `outer` (PDF row-vector convention: p' = p x inner x outer). */
function concat(inner: Matrix, outer: Matrix): Matrix {
  const [a, b, c, d, e, f] = inner;
  const [A, B, C, D, E, F] = outer;
  return [
    a * A + b * C,
    a * B + b * D,
    c * A + d * C,
    c * B + d * D,
    e * A + f * C + E,
    e * B + f * D + F,
  ];
}

function applyM(mx: Matrix, p: Pt): Pt {
  return { x: p.x * mx[0] + p.y * mx[2] + mx[4], y: p.x * mx[1] + p.y * mx[3] + mx[5] };
}

function mapRect(mx: Matrix, r: Rect): Rect {
  const ps = [
    { x: r.l, y: r.b },
    { x: r.r, y: r.b },
    { x: r.l, y: r.t },
    { x: r.r, y: r.t },
  ].map((p) => applyM(mx, p));
  return {
    l: Math.min(...ps.map((p) => p.x)),
    b: Math.min(...ps.map((p) => p.y)),
    r: Math.max(...ps.map((p) => p.x)),
    t: Math.max(...ps.map((p) => p.y)),
  };
}

function hex(c: string): [number, number, number] {
  const v = /^#?([0-9a-f]{6})$/i.exec(c.trim())?.[1] ?? "000000";
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
}

class Heap {
  private readonly ptrs: number[] = [];
  constructor(private readonly m: PdfiumModule) {}
  alloc(bytes: number): number {
    const p = this.m.pdfium.wasmExports.malloc(bytes);
    this.ptrs.push(p);
    return p;
  }
  free(): void {
    for (const p of this.ptrs) this.m.pdfium.wasmExports.free(p);
  }
}

function getMatrix(m: PdfiumModule, obj: number, buf: number): Matrix {
  if (!m.FPDFPageObj_GetMatrix(obj, buf)) return [...IDENTITY];
  return [0, 1, 2, 3, 4, 5].map((k) => m.pdfium.getValue(buf + k * 4, "float")) as Matrix;
}

function setMatrix(m: PdfiumModule, obj: number, mx: Matrix, buf: number): void {
  mx.forEach((v, k) => m.pdfium.setValue(buf + k * 4, v, "float"));
  m.FPDFPageObj_SetMatrix(obj, buf);
}

function readPoint(m: PdfiumModule, seg: number, buf: number): Pt {
  m.FPDFPathSegment_GetPoint(seg, buf, buf + 4);
  return { x: m.pdfium.getValue(buf, "float"), y: m.pdfium.getValue(buf + 4, "float") };
}

/** A path object's subpaths in its own space, or null if PDFium reports a bad segment. */
function readPath(m: PdfiumModule, obj: number, buf: number): SubPath[] | null {
  const subs: SubPath[] = [];
  let cur: SubPath | null = null;
  let pending: Pt[] = [];
  const n = m.FPDFPath_CountSegments(obj);
  for (let i = 0; i < n; i++) {
    const seg = m.FPDFPath_GetPathSegment(obj, i);
    const type = m.FPDFPathSegment_GetType(seg);
    const p = readPoint(m, seg, buf);
    if (type === SEG_MOVE || !cur) {
      if (type !== SEG_MOVE) return null;
      cur = { start: p, segs: [], closed: false };
      subs.push(cur);
    } else if (type === SEG_LINE) {
      cur.segs.push({ kind: "line", to: p });
    } else if (type === SEG_BEZIER) {
      pending.push(p);
      if (pending.length === 3) {
        const [c1, c2, to] = pending as [Pt, Pt, Pt];
        cur.segs.push({ kind: "curve", c1, c2, to });
        pending = [];
      }
    } else return null;
    if (m.FPDFPathSegment_GetClose(seg) && cur) cur.closed = true;
  }
  return pending.length ? null : subs;
}

function buildPath(m: PdfiumModule, subs: SubPath[]): number {
  const first = subs[0];
  if (!first) return 0;
  const obj = m.FPDFPageObj_CreateNewPath(first.start.x, first.start.y);
  subs.forEach((sp, i) => {
    if (i > 0) m.FPDFPath_MoveTo(obj, sp.start.x, sp.start.y);
    for (const s of sp.segs) {
      if (s.kind === "line") m.FPDFPath_LineTo(obj, s.to.x, s.to.y);
      else m.FPDFPath_BezierTo(obj, s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.to.x, s.to.y);
    }
    if (sp.closed) m.FPDFPath_Close(obj);
  });
  return obj;
}

/** The object's clip, when it is one axis-aligned rectangle; undefined for none; null otherwise. */
function rectClip(m: PdfiumModule, obj: number, buf: number): Rect | undefined | null {
  const clip = m.FPDFPageObj_GetClipPath(obj);
  if (!clip) return undefined;
  const n = m.FPDFClipPath_CountPaths(clip);
  if (n <= 0) return undefined;
  let box: Rect | undefined;
  for (let i = 0; i < n; i++) {
    const segs = m.FPDFClipPath_CountPathSegments(clip, i);
    const pts: Pt[] = [];
    for (let k = 0; k < segs; k++) {
      const seg = m.FPDFClipPath_GetPathSegment(clip, i, k);
      if (m.FPDFPathSegment_GetType(seg) === SEG_BEZIER) return null;
      pts.push(readPoint(m, seg, buf));
    }
    const xs = [...new Set(pts.map((p) => Math.round(p.x * 100)))];
    const ys = [...new Set(pts.map((p) => Math.round(p.y * 100)))];
    if (pts.length < 4 || xs.length !== 2 || ys.length !== 2) return null;
    const r = {
      l: Math.min(...xs) / 100,
      b: Math.min(...ys) / 100,
      r: Math.max(...xs) / 100,
      t: Math.max(...ys) / 100,
    };
    box = box
      ? {
          l: Math.max(box.l, r.l),
          b: Math.max(box.b, r.b),
          r: Math.min(box.r, r.r),
          t: Math.min(box.t, r.t),
        }
      : r;
  }
  return box;
}

function grow(r: Rect, by: number): Rect {
  return { l: r.l - by, b: r.b - by, r: r.r + by, t: r.t + by };
}

/**
 * Replaces a top-level path partly under `boxes` with the parts outside them. Returns
 * a reason when it cannot (the caller then removes the path whole).
 */
function clipPath(
  m: PdfiumModule,
  page: number,
  obj: number,
  index: number,
  pageBounds: Rect,
  boxes: Rect[],
  heap: Heap,
): string | null {
  const buf = heap.alloc(64);
  const mx = getMatrix(m, obj, buf);
  const [a, b, c, d, e, f] = mx;
  if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6 || Math.abs(a) < 1e-9 || Math.abs(d) < 1e-9) {
    return "rotated or skewed";
  }
  const clip = rectClip(m, obj, buf);
  if (clip === null || (clip && !rectInside(pageBounds, grow(clip, 0.5)))) {
    return "has its own clipping shape";
  }
  const subs = readPath(m, obj, buf);
  if (!subs) return "unreadable path";
  if (!m.FPDFPath_GetDrawMode(obj, buf, buf + 4)) return "unreadable path";
  const fillMode = m.pdfium.getValue(buf, "i32");
  const stroke = m.pdfium.getValue(buf + 4, "i32") !== 0;
  // Boxes into the path's own space (axis-aligned scale + move, checked above).
  const toLocal = (r: Rect): Rect => {
    const x1 = (r.l - e) / a;
    const x2 = (r.r - e) / a;
    const y1 = (r.b - f) / d;
    const y2 = (r.t - f) / d;
    return { l: Math.min(x1, x2), r: Math.max(x1, x2), b: Math.min(y1, y2), t: Math.max(y1, y2) };
  };
  const local = boxes.map(toLocal);

  const made: number[] = [];
  if (fillMode !== 0) {
    let parts = subs;
    for (const box of local) parts = fillOutside(parts, box);
    const o = buildPath(m, parts);
    if (o) {
      m.FPDFPath_SetDrawMode(o, fillMode, false);
      if (m.FPDFPageObj_GetFillColor(obj, buf, buf + 4, buf + 8, buf + 12)) {
        const u = (k: number) => m.pdfium.getValue(buf + k * 4, "i32") >>> 0;
        m.FPDFPageObj_SetFillColor(o, u(0), u(1), u(2), u(3));
      }
      made.push(o);
    }
  }
  if (stroke) {
    m.FPDFPageObj_GetStrokeWidth(obj, buf);
    const width = Math.max(m.pdfium.getValue(buf, "float"), 0);
    // Half the line width (in the path's space) keeps the stroke's edge and caps out.
    const half = width / 2 + 0.01;
    let pieces: StrokePiece[] = subs.map((sp) => ({ ...sp, dashOffset: 0 }));
    for (const box of local) {
      // A second box cuts pieces of the first; offsets add up along the way.
      pieces = pieces.flatMap((p) =>
        strokeOutside([p], grow(box, half)).map((q) => ({
          ...q,
          dashOffset: q.dashOffset + p.dashOffset,
        })),
      );
    }
    const dashes = m.FPDFPageObj_GetDashCount(obj);
    const dashArr = dashes > 0 ? heap.alloc(dashes * 4) : 0;
    const dashed = dashes > 0 && m.FPDFPageObj_GetDashArray(obj, dashArr, dashes);
    let phase = 0;
    if (dashed && m.FPDFPageObj_GetDashPhase(obj, buf)) phase = m.pdfium.getValue(buf, "float");
    // A dash pattern restarts at every subpath, so each dashed piece is its own object
    // with the phase it had at that point of the original line.
    const groups = dashed ? pieces.map((p) => [p]) : [pieces];
    for (const group of groups) {
      const o = buildPath(m, group);
      if (!o) continue;
      m.FPDFPath_SetDrawMode(o, 0, true);
      const u = (k: number) => m.pdfium.getValue(buf + k * 4, "i32") >>> 0;
      if (m.FPDFPageObj_GetStrokeColor(obj, buf, buf + 4, buf + 8, buf + 12)) {
        m.FPDFPageObj_SetStrokeColor(o, u(0), u(1), u(2), u(3));
      }
      m.FPDFPageObj_SetStrokeWidth(o, width);
      m.FPDFPageObj_SetLineJoin(o, m.FPDFPageObj_GetLineJoin(obj));
      m.FPDFPageObj_SetLineCap(o, m.FPDFPageObj_GetLineCap(obj));
      if (dashed)
        m.FPDFPageObj_SetDashArray(o, dashArr, dashes, phase + (group[0]?.dashOffset ?? 0));
      made.push(o);
    }
  }
  made.forEach((o, k) => {
    setMatrix(m, o, mx, buf);
    m.FPDFPage_InsertObjectAtIndex(page, o, index + k);
  });
  m.FPDFPage_RemoveObject(page, obj);
  m.FPDFPageObj_Destroy(obj);
  return null;
}

interface Found {
  obj: number;
  type: number;
  /** Bounds in page space. */
  bounds: Rect;
  /** The form XObject holding it, or 0 at page level. */
  form: number;
}

/** Every page object (forms' contents too), with page-space bounds. */
function walk(m: PdfiumModule, page: number, buf: number): Found[] {
  const out: Found[] = [];
  const visit = (form: number, ctm: Matrix) => {
    const n = form ? m.FPDFFormObj_CountObjects(form) : m.FPDFPage_CountObjects(page);
    for (let i = 0; i < n; i++) {
      const obj = form ? m.FPDFFormObj_GetObject(form, i) : m.FPDFPage_GetObject(page, i);
      const type = m.FPDFPageObj_GetType(obj);
      const b = objBounds(m, obj);
      if (b) out.push({ obj, type, bounds: form ? mapRect(ctm, b) : b, form });
      // A form object's matrix maps its contents into the space that holds it.
      if (type === OBJ_FORM) visit(obj, concat(getMatrix(m, obj, buf), ctm));
    }
  };
  visit(0, IDENTITY);
  return out;
}

/** Gives an image object its own stream, decoded and re-encoded from its pixels. */
function privateImage(m: PdfiumModule, obj: number): void {
  const bmp = m.FPDFImageObj_GetBitmap(obj);
  if (!bmp) throw new Error("PDFium could not read an image under a redaction box");
  try {
    if (!m.FPDFImageObj_SetBitmap(0, 0, obj, bmp)) {
      throw new Error("PDFium could not rewrite an image under a redaction box");
    }
  } finally {
    m.FPDFBitmap_Destroy(bmp);
  }
}

function indexOf(m: PdfiumModule, page: number, obj: number): number {
  const n = m.FPDFPage_CountObjects(page);
  for (let i = 0; i < n; i++) if (m.FPDFPage_GetObject(page, i) === obj) return i;
  return -1;
}

function removeObj(m: PdfiumModule, page: number, f: Found): void {
  const ok = f.form
    ? m.FPDFFormObj_RemoveObject(f.form, f.obj)
    : m.FPDFPage_RemoveObject(page, f.obj);
  if (!ok) throw new Error("PDFium could not remove an object under a redaction box");
  m.FPDFPageObj_Destroy(f.obj);
}

function drawOverlay(
  m: PdfiumModule,
  doc: number,
  page: number,
  rects: Rect[],
  o: OverlayOptions,
  heap: Heap,
) {
  for (const r of rects) {
    const w = r.r - r.l;
    const h = r.t - r.b;
    if (w <= 0 || h <= 0) continue;
    if (o.fill) {
      const box = m.FPDFPageObj_CreateNewRect(r.l, r.b, w, h);
      const [cr, cg, cb] = hex(o.fill);
      m.FPDFPageObj_SetFillColor(box, cr, cg, cb, 255);
      m.FPDFPath_SetDrawMode(box, FILL_ALTERNATE, false);
      m.FPDFPage_InsertObject(page, box);
    }
    const text = o.text.trim();
    if (!text) continue;
    const font = m.FPDFText_LoadStandardFont(doc, "Helvetica");
    const buf = heap.alloc((text.length + 1) * 2 + 64);
    // Width at 1 pt, measured by PDFium, decides the size.
    const probe = m.FPDFPageObj_CreateTextObj(doc, font, 1);
    m.pdfium.stringToUTF16(text, buf, (text.length + 1) * 2);
    m.FPDFText_SetText(probe, buf);
    const unit = objBounds(m, probe);
    m.FPDFPageObj_Destroy(probe);
    if (!unit || unit.r - unit.l <= 0) continue;
    const perPt = unit.r - unit.l;
    const size = Math.min(12, h * 0.7, (w - 4) / perPt);
    if (size < 4) continue;
    const tw = perPt * size;
    const place = (x: number, y: number) => {
      const t = m.FPDFPageObj_CreateTextObj(doc, font, size);
      m.pdfium.stringToUTF16(text, buf, (text.length + 1) * 2);
      m.FPDFText_SetText(t, buf);
      const [cr, cg, cb] = hex(o.textColor);
      m.FPDFPageObj_SetFillColor(t, cr, cg, cb, 255);
      m.FPDFPageObj_Transform(t, 1, 0, 0, 1, x, y);
      m.FPDFPage_InsertObject(page, t);
    };
    // Baseline offset: Helvetica's cap height is about 0.72 of the size.
    const cap = size * 0.72;
    if (!o.repeat) {
      place(r.l + (w - tw) / 2, r.b + (h - cap) / 2);
      continue;
    }
    const stepX = tw + size;
    const stepY = size * 1.6;
    const rows = Math.max(1, Math.floor((h - cap) / stepY) + 1);
    const cols = Math.max(1, Math.floor((w - tw) / stepX) + 1);
    const y0 = r.b + (h - (cap + (rows - 1) * stepY)) / 2;
    const x0 = r.l + (w - (tw + (cols - 1) * stepX)) / 2;
    for (let i = 0; i < rows; i++)
      for (let k = 0; k < cols; k++) place(x0 + k * stepX, y0 + i * stepY);
  }
}

/** Text whose character centres lie in the boxes, in reading order. */
function textUnder(m: PdfiumModule, page: number, rects: Rect[]): string {
  const tp = m.FPDFText_LoadPage(page);
  try {
    let s = "";
    for (const c of pageChars(m, tp)) {
      const x = (c.l + c.r) / 2;
      const y = (c.b + c.t) / 2;
      if (rects.some((r) => x >= r.l && x <= r.r && y >= r.b && y <= r.t)) s += c.ch;
      else if (s && !s.endsWith(" ")) s += " ";
    }
    return s.trim();
  } finally {
    m.FPDFText_ClosePage(tp);
  }
}

/** Removes everything under the boxes from page content and draws the overlay. */
export function redactContent(
  m: PdfiumModule,
  bytes: Uint8Array,
  pages: PageRedaction[],
  overlay: OverlayOptions = DEFAULT_OVERLAY,
): { bytes: Uint8Array; report: ContentReport } {
  const report: ContentReport = {
    removedText: [],
    imagesRemoved: 0,
    pathsClipped: 0,
    pathsRemovedWhole: [],
  };
  const doc = RawDoc.open(m, bytes);
  try {
    for (const { pageIndex, rects: raw } of pages) {
      const rects = raw.filter((r) => r.r > r.l && r.t > r.b);
      if (!rects.length) continue;
      doc.withPage(
        pageIndex,
        (page) => {
          const heap = new Heap(m);
          try {
            report.removedText.push({ pageIndex, text: textUnder(m, page, rects) });

            // Quads in PDF order: top-left, top-right, bottom-left, bottom-right.
            const q = heap.alloc(32 * rects.length);
            rects.forEach((r, i) => {
              [r.l, r.t, r.r, r.t, r.l, r.b, r.r, r.b].forEach((v, k) =>
                m.pdfium.setValue(q + i * 32 + k * 4, v, "float"),
              );
            });
            const buf = heap.alloc(64);
            // Images first. One image stream can be drawn in several places (and on
            // other pages); PDFium wipes the pixels in the stream, so a copy outside the
            // box would lose them too. Covered placements go now; partly covered ones get
            // a private stream (GetBitmap/SetBitmap) that PDFium then wipes.
            for (const f of walk(m, page, buf).reverse()) {
              if (f.type !== OBJ_IMAGE) continue;
              const under = rects.filter((r) => rectsOverlap(f.bounds, r));
              if (!under.length) continue;
              if (under.some((r) => rectInside(f.bounds, r))) {
                removeObj(m, page, f);
                report.imagesRemoved++;
              } else privateImage(m, f.obj);
            }

            m.EPDFText_RedactInQuads(page, q, rects.length, true, false);

            for (const f of walk(m, page, buf).reverse()) {
              const under = rects.filter((r) => rectsOverlap(f.bounds, r));
              if (!under.length) continue;
              const whole = under.some((r) => rectInside(f.bounds, r));
              if (f.type === OBJ_SHADING) {
                if (whole) removeObj(m, page, f);
              } else if (f.type === OBJ_PATH) {
                if (whole) {
                  removeObj(m, page, f);
                  continue;
                }
                const reason = f.form
                  ? "inside a form XObject"
                  : clipPath(m, page, f.obj, indexOf(m, page, f.obj), f.bounds, under, heap);
                if (reason) {
                  removeObj(m, page, f);
                  report.pathsRemovedWhole.push({ pageIndex, bounds: f.bounds, reason });
                } else report.pathsClipped++;
              }
            }
            drawOverlay(m, doc.ptr, page, rects, overlay, heap);
          } finally {
            heap.free();
          }
        },
        true,
      );
    }
    return { bytes: doc.save(), report };
  } finally {
    doc.close();
  }
}
