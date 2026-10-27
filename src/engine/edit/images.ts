// Edit PDF (B3): images on a page. List, add, move, resize, rotate, replace and delete
// image objects with PDFium. A JPEG goes in unchanged (DCTDecode, never re-encoded):
// PDFium reads it through FPDFImageObj_LoadJpegFileInline. PNGs are decoded with our
// own decoder (src/engine/pages/png.ts) and handed to PDFium as a bitmap, alpha kept.
//
// Placement is the image's matrix, which maps the unit square onto the page. The UI
// works with centre, size and rotation instead (`Placement`); skew is not offered.
// Only images drawn directly on the page are listed (not inside form XObjects).

import type { PdfiumModule } from "../pdfium";
import { heap } from "../pages/raw";
import { decodePng } from "../pages/png";
import { sniffImage } from "../pages/images";
import { objBounds, type Rect } from "./chars";
import { EditRefused } from "./refusal";

const FPDF_PAGEOBJ_IMAGE = 3;
const FPDFBitmap_BGRA = 4;

/** Where an image sits: centre, size in points, rotation in degrees (counter-clockwise). */
export interface Placement {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PageImage {
  /** PDFium handle, valid while the page is loaded. */
  obj: number;
  /** Drawing order on the page. */
  index: number;
  placement: Placement;
  bounds: Rect;
  pixels: { width: number; height: number };
  /** Filters on the image stream ("DCTDecode" for a JPEG). */
  filters: string[];
}

export type Matrix = [number, number, number, number, number, number];

export function placementToMatrix(p: Placement): Matrix {
  const t = (p.rotation * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const a = p.width * cos;
  const b = p.width * sin;
  const c = -p.height * sin;
  const d = p.height * cos;
  // The unit square's centre (0.5, 0.5) lands on (cx, cy).
  return [a, b, c, d, p.cx - (a + c) / 2, p.cy - (b + d) / 2];
}

export function matrixToPlacement([a, b, c, d, e, f]: Matrix): Placement {
  return {
    cx: e + (a + c) / 2,
    cy: f + (b + d) / 2,
    width: Math.hypot(a, b),
    height: Math.hypot(c, d),
    rotation: (Math.atan2(b, a) * 180) / Math.PI,
  };
}

function getMatrix(m: PdfiumModule, obj: number): Matrix {
  const p = m.pdfium.wasmExports.malloc(24);
  try {
    if (!m.FPDFPageObj_GetMatrix(obj, p)) throw new Error("image has no matrix");
    const f = (k: number) => m.pdfium.getValue(p + k * 4, "float");
    return [f(0), f(1), f(2), f(3), f(4), f(5)];
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}

function setMatrix(m: PdfiumModule, obj: number, mx: Matrix): void {
  const p = m.pdfium.wasmExports.malloc(24);
  try {
    mx.forEach((v, k) => m.pdfium.setValue(p + k * 4, v, "float"));
    if (!m.FPDFPageObj_SetMatrix(obj, p)) throw new Error("PDFium could not place the image");
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}

function filtersOf(m: PdfiumModule, obj: number): string[] {
  const n = m.FPDFImageObj_GetImageFilterCount(obj);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const len = m.FPDFImageObj_GetImageFilter(obj, i, 0, 0);
    const p = m.pdfium.wasmExports.malloc(Math.max(1, len));
    try {
      m.FPDFImageObj_GetImageFilter(obj, i, p, len);
      out.push(m.pdfium.UTF8ToString(p));
    } finally {
      m.pdfium.wasmExports.free(p);
    }
  }
  return out;
}

/** Every image drawn directly on the loaded page, in drawing order. */
export function pageImages(m: PdfiumModule, page: number): PageImage[] {
  const out: PageImage[] = [];
  const n = m.FPDFPage_CountObjects(page);
  const p = m.pdfium.wasmExports.malloc(8);
  try {
    for (let i = 0; i < n; i++) {
      const obj = m.FPDFPage_GetObject(page, i);
      if (m.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_IMAGE) continue;
      const bounds = objBounds(m, obj);
      if (!bounds) continue;
      const ok = m.FPDFImageObj_GetImagePixelSize(obj, p, p + 4);
      out.push({
        obj,
        index: i,
        placement: matrixToPlacement(getMatrix(m, obj)),
        bounds,
        pixels: ok
          ? { width: m.pdfium.getValue(p, "i32"), height: m.pdfium.getValue(p + 4, "i32") }
          : { width: 0, height: 0 },
        filters: filtersOf(m, obj),
      });
    }
  } finally {
    m.pdfium.wasmExports.free(p);
  }
  return out;
}

/** Moves, resizes and/or rotates an image. */
export function placeImage(m: PdfiumModule, page: number, obj: number, p: Placement): void {
  setMatrix(m, obj, placementToMatrix(p));
  regenerate(m, page);
}

/** Pixel size of image file bytes (JPEG or PNG), for sizing a new image. */
export function imageFileSize(data: Uint8Array): { width: number; height: number } {
  const kind = sniffImage(data);
  if (kind === "png") {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (kind === "jpeg") {
    // Walk the markers to the first start-of-frame.
    let o = 2;
    while (o + 9 < data.length) {
      if (data[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = data[o + 1] ?? 0;
      const len = ((data[o + 2] ?? 0) << 8) | (data[o + 3] ?? 0);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          height: ((data[o + 5] ?? 0) << 8) | (data[o + 6] ?? 0),
          width: ((data[o + 7] ?? 0) << 8) | (data[o + 8] ?? 0),
        };
      }
      o += 2 + len;
    }
  }
  throw new EditRefused("Only JPEG and PNG images can be added.");
}

/** Adds an image (JPEG or PNG bytes) at `p`, on top of the page. Returns its handle. */
export function addImage(
  m: PdfiumModule,
  doc: number,
  page: number,
  data: Uint8Array,
  p: Placement,
): number {
  const obj = m.FPDFPageObj_NewImageObj(doc);
  if (!obj) throw new Error("PDFium could not create an image");
  try {
    loadInto(m, page, obj, data);
    setMatrix(m, obj, placementToMatrix(p));
  } catch (e) {
    m.FPDFPageObj_Destroy(obj);
    throw e;
  }
  m.FPDFPage_InsertObject(page, obj);
  regenerate(m, page);
  return obj;
}

/**
 * Replaces an image's picture with `data`, keeping its place: the new picture fits
 * inside the old size with its own proportions, centred, same rotation. Drawing order
 * is kept (it is the same object).
 */
export function replaceImage(
  m: PdfiumModule,
  page: number,
  obj: number,
  data: Uint8Array,
): Placement {
  const old = matrixToPlacement(getMatrix(m, obj));
  const px = imageFileSize(data);
  const scale = Math.min(old.width / px.width, old.height / px.height);
  const next = { ...old, width: px.width * scale, height: px.height * scale };
  loadInto(m, page, obj, data);
  setMatrix(m, obj, placementToMatrix(next));
  regenerate(m, page);
  return next;
}

export function deleteImage(m: PdfiumModule, page: number, obj: number): void {
  if (!m.FPDFPage_RemoveObject(page, obj)) throw new Error("PDFium could not remove the image");
  m.FPDFPageObj_Destroy(obj);
  regenerate(m, page);
}

function regenerate(m: PdfiumModule, page: number): void {
  if (!m.FPDFPage_GenerateContent(page)) throw new Error("PDFium could not regenerate the page");
}

/** Puts `data` into image object `obj`: JPEG unchanged, PNG as a bitmap (alpha kept). */
function loadInto(m: PdfiumModule, page: number, obj: number, data: Uint8Array): void {
  const kind = sniffImage(data);
  const ex = m.pdfium.wasmExports;
  const pages = ex.malloc(4);
  m.pdfium.setValue(pages, page, "i32");
  try {
    if (kind === "jpeg") {
      if (!loadJpeg(m, pages, obj, data)) throw new EditRefused("This JPEG could not be read.");
      return;
    }
    if (kind !== "png") throw new EditRefused("Only JPEG and PNG images can be added.");
    let rgba;
    try {
      rgba = decodePng(data);
    } catch {
      throw new EditRefused("This PNG could not be read.");
    }
    const { width, height } = rgba;
    const bmp = m.FPDFBitmap_Create(width, height, 1);
    if (!bmp) throw new EditRefused("This image is too large.");
    try {
      if (m.FPDFBitmap_GetFormat(bmp) !== FPDFBitmap_BGRA)
        throw new Error("unexpected bitmap format");
      const buf = m.FPDFBitmap_GetBuffer(bmp);
      const stride = m.FPDFBitmap_GetStride(bmp);
      const h = heap(m);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const s = (y * width + x) * 4;
          const d = buf + y * stride + x * 4;
          h[d] = rgba.data[s + 2] ?? 0;
          h[d + 1] = rgba.data[s + 1] ?? 0;
          h[d + 2] = rgba.data[s] ?? 0;
          h[d + 3] = rgba.data[s + 3] ?? 255;
        }
      }
      if (!m.FPDFImageObj_SetBitmap(pages, 1, obj, bmp))
        throw new Error("PDFium could not set the image");
    } finally {
      m.FPDFBitmap_Destroy(bmp);
    }
  } finally {
    ex.free(pages);
  }
}

/** FPDFImageObj_LoadJpegFileInline with an FPDF_FILEACCESS reading from wasm memory. */
function loadJpeg(m: PdfiumModule, pages: number, obj: number, data: Uint8Array): boolean {
  const ex = m.pdfium.wasmExports;
  const src = ex.malloc(data.byteLength);
  heap(m).set(data, src);
  // int GetBlock(void* param, unsigned long position, unsigned char* buf, unsigned long size)
  const getBlock = m.pdfium.addFunction(
    (_param: number, pos: number, buf: number, size: number) => {
      if (pos + size > data.byteLength) return 0;
      heap(m).copyWithin(buf, src + pos, src + pos + size);
      return 1;
    },
    "iiiii",
  );
  const access = ex.malloc(12);
  try {
    m.pdfium.setValue(access, data.byteLength, "i32");
    m.pdfium.setValue(access + 4, getBlock, "i32");
    m.pdfium.setValue(access + 8, 0, "i32");
    return m.FPDFImageObj_LoadJpegFileInline(pages, 1, obj, access);
  } finally {
    m.pdfium.removeFunction(getBlock);
    ex.free(access);
    ex.free(src);
  }
}
