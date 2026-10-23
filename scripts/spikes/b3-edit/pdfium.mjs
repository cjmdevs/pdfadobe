// B3 spike: thin helpers over EmbedPDF's raw PDFium module (Node). Throwaway code; the
// real engine API is designed after the spike report is approved.
//
// Coordinates here are raw PDF user space (bottom-left origin, points).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { init } from "@embedpdf/pdfium";

const require = createRequire(import.meta.url);

export async function loadPdfium() {
  const wasm = readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"));
  const m = await init({
    wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
  });
  m.PDFiumExt_Init();
  return m;
}

/** Scratch memory with typed reads; everything allocated is freed by `free()`. */
export class Mem {
  constructor(m) {
    this.m = m;
    this.ptrs = [];
  }
  get ex() {
    return this.m.pdfium.wasmExports;
  }
  get heap() {
    return this.m.pdfium.HEAPU8;
  }
  alloc(n) {
    const p = this.ex.malloc(Math.max(8, n));
    this.ptrs.push(p);
    return p;
  }
  bytes(data) {
    const p = this.alloc(data.byteLength);
    this.heap.set(data, p);
    return p;
  }
  /** UTF-16LE, null-terminated (FPDF_WIDESTRING). */
  wide(str) {
    const p = this.alloc((str.length + 1) * 2);
    const v = new DataView(this.heap.buffer);
    for (let i = 0; i < str.length; i++) v.setUint16(p + i * 2, str.charCodeAt(i), true);
    v.setUint16(p + str.length * 2, 0, true);
    return p;
  }
  f32(p, i = 0) {
    return new DataView(this.heap.buffer).getFloat32(p + i * 4, true);
  }
  f64(p, i = 0) {
    return new DataView(this.heap.buffer).getFloat64(p + i * 8, true);
  }
  u32(p, i = 0) {
    return new DataView(this.heap.buffer).getUint32(p + i * 4, true);
  }
  readWide(p, bytes) {
    const v = new DataView(this.heap.buffer);
    let s = "";
    for (let i = 0; i + 1 < bytes; i += 2) {
      const c = v.getUint16(p + i, true);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  readAscii(p, bytes) {
    let s = "";
    for (let i = 0; i < bytes; i++) {
      const c = this.heap[p + i];
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  free() {
    for (const p of this.ptrs) this.ex.free(p);
    this.ptrs = [];
  }
}

export function openDoc(m, bytes) {
  const mem = new Mem(m);
  const filePtr = mem.bytes(bytes);
  const doc = m.FPDF_LoadMemDocument(filePtr, bytes.byteLength, "");
  if (!doc) throw new Error(`PDFium could not open the document (error ${m.FPDF_GetLastError()})`);
  return {
    doc,
    close() {
      m.FPDF_CloseDocument(doc);
      mem.free();
    },
  };
}

export function saveDoc(m, doc) {
  const writer = m.PDFiumExt_OpenFileWriter();
  try {
    if (!m.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error("PDFium could not save");
    const size = m.PDFiumExt_GetFileWriterSize(writer);
    const mem = new Mem(m);
    const data = mem.alloc(size);
    m.PDFiumExt_GetFileWriterData(writer, data, size);
    const out = mem.heap.slice(data, data + size);
    mem.free();
    return out;
  } finally {
    m.PDFiumExt_CloseFileWriter(writer);
  }
}

export function objBounds(m, obj) {
  const mem = new Mem(m);
  const p = mem.alloc(16);
  const ok = m.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12);
  const r = ok ? { l: mem.f32(p, 0), b: mem.f32(p, 1), r: mem.f32(p, 2), t: mem.f32(p, 3) } : null;
  mem.free();
  return r;
}

export function textObjText(m, textPage, obj) {
  const mem = new Mem(m);
  const n = m.FPDFTextObj_GetText(obj, textPage, 0, 0);
  const p = mem.alloc(n);
  m.FPDFTextObj_GetText(obj, textPage, p, n);
  const s = mem.readWide(p, n);
  mem.free();
  return s;
}

export function fontName(m, font) {
  const mem = new Mem(m);
  const n = m.FPDFFont_GetBaseFontName(font, 0, 0);
  const p = mem.alloc(n);
  m.FPDFFont_GetBaseFontName(font, p, n);
  const s = mem.readAscii(p, n);
  mem.free();
  return s;
}

/** The embedded font program, or null when the font is not embedded. */
export function fontData(m, font) {
  if (!m.FPDFFont_GetIsEmbedded(font)) return null;
  const mem = new Mem(m);
  const lenP = mem.alloc(8);
  m.FPDFFont_GetFontData(font, 0, 0, lenP);
  const n = mem.u32(lenP);
  const p = mem.alloc(n);
  m.FPDFFont_GetFontData(font, p, n, lenP);
  const out = mem.heap.slice(p, p + n);
  mem.free();
  return out;
}

export function fillColor(m, obj) {
  const mem = new Mem(m);
  const p = mem.alloc(16);
  m.FPDFPageObj_GetFillColor(obj, p, p + 4, p + 8, p + 12);
  const c = { r: mem.u32(p, 0), g: mem.u32(p, 1), b: mem.u32(p, 2), a: mem.u32(p, 3) };
  mem.free();
  return c;
}

/** Every character on a page with its origin, box, size, font and text object. */
export function pageChars(m, page, textPage) {
  const mem = new Mem(m);
  const o = mem.alloc(16);
  const box = mem.alloc(16);
  const fontBuf = mem.alloc(256);
  const flags = mem.alloc(4);
  const out = [];
  const n = m.FPDFText_CountChars(textPage);
  for (let i = 0; i < n; i++) {
    const code = m.FPDFText_GetUnicode(textPage, i);
    m.FPDFText_GetCharOrigin(textPage, i, o, o + 8);
    m.FPDFText_GetLooseCharBox(textPage, i, box);
    m.FPDFText_GetFontInfo(textPage, i, fontBuf, 256, flags);
    out.push({
      i,
      ch: String.fromCharCode(code),
      generated: m.FPDFText_IsGenerated(textPage, i) === 1,
      x: mem.f64(o, 0),
      y: mem.f64(o, 1),
      // FS_RECTF: left, top, right, bottom
      l: mem.f32(box, 0),
      t: mem.f32(box, 1),
      r: mem.f32(box, 2),
      b: mem.f32(box, 3),
      size: m.FPDFText_GetFontSize(textPage, i),
      font: mem.readAscii(fontBuf, 256),
      obj: m.FPDFText_GetTextObject(textPage, i),
    });
  }
  mem.free();
  return out;
}

/** RGBA render of one page at `scale` (1 = 72 dpi). */
export function renderPage(m, doc, index, scale = 2) {
  const page = m.FPDF_LoadPage(doc, index);
  const w = Math.round(m.FPDF_GetPageWidthF(page) * scale);
  const h = Math.round(m.FPDF_GetPageHeightF(page) * scale);
  const bmp = m.FPDFBitmap_Create(w, h, 1);
  m.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff);
  // FPDF_ANNOT | FPDF_LCD_TEXT off; 0x01 = annotations
  m.FPDF_RenderPageBitmap(bmp, page, 0, 0, w, h, 0, 0x01);
  const buf = m.FPDFBitmap_GetBuffer(bmp);
  const stride = m.FPDFBitmap_GetStride(bmp);
  const heap = m.pdfium.HEAPU8;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = buf + y * stride + x * 4; // BGRA
      const d = (y * w + x) * 4;
      rgba[d] = heap[s + 2];
      rgba[d + 1] = heap[s + 1];
      rgba[d + 2] = heap[s];
      rgba[d + 3] = 255;
    }
  }
  m.FPDFBitmap_Destroy(bmp);
  m.FPDF_ClosePage(page);
  return { width: w, height: h, data: rgba, scale };
}
