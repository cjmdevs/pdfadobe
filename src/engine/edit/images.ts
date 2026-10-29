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
import { decodePng, encodePng } from "../pages/png";
import { sniffImage } from "../pages/images";
import { objBounds, type Rect } from "./chars";
import { EditRefused } from "./refusal";

const FPDF_PAGEOBJ_IMAGE = 3;
const FPDFBitmap_BGRA = 4;

/**
 * Where an image sits: centre, size in points, rotation in degrees (counter-clockwise),
 * and whether it is mirrored left to right (a vertical flip is that plus 180 degrees).
 */
export interface Placement {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
  flip?: boolean;
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
  // The unit square's centre (0.5, 0.5) lands on (cx, cy); a mirror swaps its x.
  const [a2, b2] = p.flip ? [-a, -b] : [a, b];
  return [a2, b2, c, d, p.cx - (a2 + c) / 2, p.cy - (b2 + d) / 2];
}

export function matrixToPlacement([a, b, c, d, e, f]: Matrix): Placement {
  // A negative determinant: mirrored (the x axis runs backwards).
  const flip = a * d - b * c < 0;
  const [ua, ub] = flip ? [-a, -b] : [a, b];
  return {
    cx: e + (a + c) / 2,
    cy: f + (b + d) / 2,
    width: Math.hypot(a, b),
    height: Math.hypot(c, d),
    rotation: (Math.atan2(ub, ua) * 180) / Math.PI,
    ...(flip ? { flip } : {}),
  };
}

/** The placement flipped left-right ("h") or top-bottom ("v") on the page. */
export function flipped(p: Placement, axis: "h" | "v"): Placement {
  // Mirroring on the page = mirroring the image and turning the other way; a vertical
  // flip is a horizontal one turned 180 degrees.
  const rotation = -p.rotation + (axis === "v" ? 180 : 0);
  return { ...p, flip: !p.flip, rotation: (((rotation % 360) + 540) % 360) - 180 };
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
  setPlacement(m, obj, p);
  regenerate(m, page);
}

/** Sets an image's placement (the page content still needs regenerating). */
export function setPlacement(m: PdfiumModule, obj: number, p: Placement): void {
  setMatrix(m, obj, placementToMatrix(p));
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

/**
 * Crops an image to `part` (fractions of the picture, 0..1 from its bottom-left). The
 * pixels outside are removed from the file, not just hidden, and the image keeps its
 * place on the page. The picture is stored again losslessly (a JPEG becomes Flate).
 */
export function cropImage(
  m: PdfiumModule,
  page: number,
  obj: number,
  part: { x0: number; y0: number; x1: number; y1: number },
): void {
  const src = m.FPDFImageObj_GetBitmap(obj);
  if (!src) throw new EditRefused("This image's pixels could not be read.");
  try {
    const w = m.FPDFBitmap_GetWidth(src);
    const h = m.FPDFBitmap_GetHeight(src);
    // Bitmap rows run top to bottom; `part` is measured from the bottom.
    const px0 = Math.max(0, Math.floor(part.x0 * w));
    const px1 = Math.min(w, Math.ceil(part.x1 * w));
    const py0 = Math.max(0, Math.floor((1 - part.y1) * h));
    const py1 = Math.min(h, Math.ceil((1 - part.y0) * h));
    const cw = px1 - px0;
    const ch = py1 - py0;
    if (cw < 1 || ch < 1) throw new EditRefused("The crop leaves nothing of the image.");
    const rgba = bitmapRgba(m, src, px0, py0, cw, ch);
    const pages = m.pdfium.wasmExports.malloc(4);
    m.pdfium.setValue(pages, page, "i32");
    try {
      setRgba(m, pages, obj, rgba, cw, ch);
    } finally {
      m.pdfium.wasmExports.free(pages);
    }
    // The new picture covers the kept part of the old unit square.
    const [a, b, c, d, e, f] = getMatrix(m, obj);
    const fx0 = px0 / w;
    const fx1 = px1 / w;
    const fy0 = 1 - py1 / h;
    const fy1 = 1 - py0 / h;
    setMatrix(m, obj, [
      a * (fx1 - fx0),
      b * (fx1 - fx0),
      c * (fy1 - fy0),
      d * (fy1 - fy0),
      e + a * fx0 + c * fy0,
      f + b * fx0 + d * fy0,
    ]);
  } finally {
    m.FPDFBitmap_Destroy(src);
  }
  regenerate(m, page);
}

/** Pixels of a PDFium bitmap (any format) as RGBA8, a `w` x `h` part from (x, y). */
function bitmapRgba(m: PdfiumModule, bmp: number, x: number, y: number, w: number, h: number) {
  const fmt = m.FPDFBitmap_GetFormat(bmp);
  const buf = m.FPDFBitmap_GetBuffer(bmp);
  const stride = m.FPDFBitmap_GetStride(bmp);
  const bpp = fmt === 1 ? 1 : fmt === 2 ? 3 : 4;
  const heapView = heap(m);
  const out = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++)
    for (let k = 0; k < w; k++) {
      const s = buf + (y + r) * stride + (x + k) * bpp;
      const o = (r * w + k) * 4;
      if (bpp === 1) {
        const g = heapView[s] ?? 0;
        out.set([g, g, g, 255], o);
      } else
        out.set(
          [
            heapView[s + 2] ?? 0,
            heapView[s + 1] ?? 0,
            heapView[s] ?? 0,
            fmt === 4 ? (heapView[s + 3] ?? 255) : 255,
          ],
          o,
        );
    }
  return out;
}

/** Puts RGBA8 pixels into an image object (PDFium stores them Flate, alpha kept). */
function setRgba(
  m: PdfiumModule,
  pages: number,
  obj: number,
  rgba: Uint8Array,
  w: number,
  h: number,
) {
  const bmp = m.FPDFBitmap_Create(w, h, 1);
  if (!bmp) throw new EditRefused("This image is too large.");
  try {
    if (m.FPDFBitmap_GetFormat(bmp) !== FPDFBitmap_BGRA)
      throw new Error("unexpected bitmap format");
    const buf = m.FPDFBitmap_GetBuffer(bmp);
    const stride = m.FPDFBitmap_GetStride(bmp);
    const hv = heap(m);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4;
        const d = buf + y * stride + x * 4;
        hv[d] = rgba[s + 2] ?? 0;
        hv[d + 1] = rgba[s + 1] ?? 0;
        hv[d + 2] = rgba[s] ?? 0;
        hv[d + 3] = rgba[s + 3] ?? 255;
      }
    if (!m.FPDFImageObj_SetBitmap(pages, 1, obj, bmp))
      throw new Error("PDFium could not set the image");
  } finally {
    m.FPDFBitmap_Destroy(bmp);
  }
}

/**
 * The image's picture as a file another program can open: a JPEG as it is stored,
 * anything else as a PNG of its pixels.
 */
export function imageFile(m: PdfiumModule, obj: number): { data: Uint8Array; ext: "jpg" | "png" } {
  const filters = filtersOf(m, obj);
  if (filters.length === 1 && filters[0] === "DCTDecode") {
    const n = m.FPDFImageObj_GetImageDataRaw(obj, 0, 0);
    const p = m.pdfium.wasmExports.malloc(Math.max(1, n));
    try {
      m.FPDFImageObj_GetImageDataRaw(obj, p, n);
      return { data: heap(m).slice(p, p + n), ext: "jpg" };
    } finally {
      m.pdfium.wasmExports.free(p);
    }
  }
  const bmp = m.FPDFImageObj_GetBitmap(obj);
  if (!bmp) throw new EditRefused("This image's pixels could not be read.");
  try {
    const width = m.FPDFBitmap_GetWidth(bmp);
    const height = m.FPDFBitmap_GetHeight(bmp);
    return {
      data: encodePng({ width, height, data: bitmapRgba(m, bmp, 0, 0, width, height) }),
      ext: "png",
    };
  } finally {
    m.FPDFBitmap_Destroy(bmp);
  }
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
