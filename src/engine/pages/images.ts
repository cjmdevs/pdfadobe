// Images as PDF pages, written directly (no PDFium) so each image keeps its most
// compact faithful encoding:
// - JPEG: embedded unchanged (DCTDecode).
// - TIFF with CCITT G4 in one strip (typical office scanner output): the G4 data is
//   embedded unchanged (CCITTFaxDecode), like Acrobat does.
// - Everything else (other TIFF compressions via UTIF, PNG): decoded and stored with
//   Flate as 1-bit black-and-white, 8-bit gray, or RGB, plus a soft mask for
//   transparency.

import { zlibSync } from "fflate";
import * as UTIF from "utif2";
import { LETTER } from "./geometry";
import { decodePng } from "./png";

export type ImageKind = "jpeg" | "png" | "tiff";

export interface ImagePage {
  width: number;
  height: number;
  /** Pixels per inch from the file, or null when it does not say. */
  dpi: { x: number; y: number } | null;
  filter: "DCTDecode" | "FlateDecode" | "CCITTFaxDecode";
  colorSpace: "DeviceGray" | "DeviceRGB" | "DeviceCMYK";
  bitsPerComponent: 1 | 8;
  data: Uint8Array;
  /** Extra image dictionary entries (PDF syntax), e.g. "/DecodeParms << ... >>". */
  extra?: string;
  /** 8-bit alpha, Flate-compressed, when the image is not fully opaque. */
  alpha?: Uint8Array;
}

export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (
    (b[0] === 0x49 && b[1] === 0x49 && b[2] === 42) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[3] === 42)
  ) {
    return "tiff";
  }
  return null;
}

/** One ImagePage per image (a multi-page TIFF gives several). */
export function imagePages(bytes: Uint8Array): ImagePage[] {
  switch (sniffImage(bytes)) {
    case "jpeg":
      return [jpegPage(bytes)];
    case "png": {
      const img = decodePng(bytes);
      return [{ ...fromRgba(img.width, img.height, img.data), dpi: pngDpi(bytes) }];
    }
    case "tiff":
      return tiffPages(bytes);
    default:
      throw new Error("not a JPEG, PNG or TIFF image");
  }
}

const be16 = (b: Uint8Array, o: number) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const be32 = (b: Uint8Array, o: number) =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;

function jpegPage(b: Uint8Array): ImagePage {
  let dpi: ImagePage["dpi"] = null;
  let adobe = false;
  let o = 2;
  while (o + 4 < b.length) {
    if (b[o] !== 0xff) {
      o++;
      continue;
    }
    const marker = b[o + 1] ?? 0;
    const len = be16(b, o + 2);
    const tag = String.fromCharCode(...b.subarray(o + 4, o + 9));
    // APP0 "JFIF\0": units (0 none, 1 dpi, 2 dpcm), x density, y density.
    if (marker === 0xe0 && tag.startsWith("JFIF")) {
      const units = b[o + 11] ?? 0;
      const x = be16(b, o + 12);
      const y = be16(b, o + 14);
      if (units === 1) dpi = { x, y };
      if (units === 2) dpi = { x: x * 2.54, y: y * 2.54 };
    }
    if (marker === 0xee && tag === "Adobe") adobe = true;
    const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (sof) {
      const components = b[o + 9] ?? 0;
      const colorSpace =
        components === 1 ? "DeviceGray" : components === 4 ? "DeviceCMYK" : "DeviceRGB";
      return {
        width: be16(b, o + 7),
        height: be16(b, o + 5),
        dpi,
        filter: "DCTDecode",
        colorSpace,
        bitsPerComponent: 8,
        data: b,
        // Adobe-written CMYK JPEGs store inverted values.
        ...(components === 4 && adobe ? { extra: "/Decode [1 0 1 0 1 0 1 0]" } : {}),
      };
    }
    o += 2 + len;
  }
  throw new Error("JPEG has no frame header");
}

function pngDpi(b: Uint8Array): ImagePage["dpi"] {
  let o = 8;
  while (o + 8 < b.length) {
    const len = be32(b, o);
    const type = String.fromCharCode(...b.subarray(o + 4, o + 8));
    if (type === "pHYs" && b[o + 16] === 1) {
      return { x: be32(b, o + 8) * 0.0254, y: be32(b, o + 12) * 0.0254 };
    }
    if (type === "IDAT") break;
    o += 12 + len;
  }
  return null;
}

function tiffPages(bytes: Uint8Array): ImagePage[] {
  const buf = bytes.slice().buffer;
  const pages: ImagePage[] = [];
  for (const ifd of UTIF.decode(buf)) {
    // NewSubfileType bit 0: a reduced-resolution copy (thumbnail), not a page.
    if ((tag(ifd, "t254") ?? 0) & 1) continue;
    const g4 = g4Passthrough(bytes, ifd);
    if (g4) {
      pages.push({ ...g4, dpi: tiffDpi(ifd) });
      continue;
    }
    UTIF.decodeImage(buf, ifd);
    if (!ifd.width || !ifd.height) continue;
    pages.push({ ...fromRgba(ifd.width, ifd.height, UTIF.toRGBA8(ifd)), dpi: tiffDpi(ifd) });
  }
  if (!pages.length) throw new Error("the TIFF file has no images");
  return pages;
}

/** First value of a TIFF tag; rationals decode as [[numerator, denominator]]. */
function tag(ifd: UTIF.IFD, t: string): number | null {
  const v = (ifd[t] as unknown[] | undefined)?.[0];
  if (Array.isArray(v)) return v[1] ? Number(v[0]) / Number(v[1]) : null;
  return v === undefined ? null : Number(v);
}

/**
 * CCITT Group 4 in a single strip with normal bit order: embed the strip unchanged.
 * CCITT "white" runs decode to pixel value 0. With PhotometricInterpretation 0
 * (WhiteIsZero, the usual for fax/scans) that is white, which is PDF's default
 * (BlackIs1 false); with 1 (BlackIsZero) the colors are swapped, so BlackIs1 true.
 * tests/unit/pages-ops.test.ts renders both and compares with the source pixels.
 */
function g4Passthrough(bytes: Uint8Array, ifd: UTIF.IFD): Omit<ImagePage, "dpi"> | null {
  const offsets = ifd["t273"] as number[] | undefined;
  const counts = ifd["t279"] as number[] | undefined;
  const width = tag(ifd, "t256");
  const height = tag(ifd, "t257");
  if (
    tag(ifd, "t259") !== 4 ||
    (tag(ifd, "t266") ?? 1) !== 1 ||
    ((tag(ifd, "t293") ?? 0) & 2) !== 0 || // T6Options bit 1: uncompressed mode
    offsets?.length !== 1 ||
    counts?.length !== 1 ||
    !width ||
    !height
  ) {
    return null;
  }
  const photometric = tag(ifd, "t262") ?? 0;
  if (photometric > 1) return null;
  const start = offsets[0] ?? 0;
  return {
    width,
    height,
    filter: "CCITTFaxDecode",
    colorSpace: "DeviceGray",
    bitsPerComponent: 1,
    data: bytes.slice(start, start + (counts[0] ?? 0)),
    extra: `/DecodeParms << /K -1 /Columns ${width} /Rows ${height} /BlackIs1 ${photometric === 1} >>`,
  };
}

function tiffDpi(ifd: UTIF.IFD): ImagePage["dpi"] {
  const x = tag(ifd, "t282");
  const y = tag(ifd, "t283") ?? x;
  if (!x || !y) return null;
  const unit = tag(ifd, "t296") ?? 2; // 2 inch (default), 3 centimetre, 1 none
  if (unit === 1) return null;
  return unit === 3 ? { x: x * 2.54, y: y * 2.54 } : { x, y };
}

/** Smallest faithful Flate encoding of RGBA pixels: 1-bit, 8-bit gray, or RGB (+ alpha). */
export function fromRgba(w: number, h: number, rgba: Uint8Array): Omit<ImagePage, "dpi"> {
  let gray = true;
  let bilevel = true;
  let opaque = true;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] ?? 0;
    if (rgba[i + 3] !== 255) opaque = false;
    if (gray && (r !== rgba[i + 1] || r !== rgba[i + 2])) gray = bilevel = false;
    if (bilevel && r !== 0 && r !== 255) bilevel = false;
  }
  const channels = gray ? 1 : 3;
  const stride = bilevel ? Math.ceil(w / 8) : w * channels;
  const pixels = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const row = y * stride;
      if (bilevel) {
        if (rgba[p] === 255)
          pixels[row + (x >> 3)] = (pixels[row + (x >> 3)] ?? 0) | (0x80 >> (x & 7));
      } else if (gray) {
        pixels[row + x] = rgba[p] ?? 0;
      } else {
        pixels.set(rgba.subarray(p, p + 3), row + x * 3);
      }
    }
  }
  let alpha: Uint8Array | undefined;
  if (!opaque) {
    const a = new Uint8Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = rgba[i * 4 + 3] ?? 0;
    alpha = zlibSync(a, { level: 6 });
  }
  return {
    width: w,
    height: h,
    filter: "FlateDecode",
    colorSpace: gray ? "DeviceGray" : "DeviceRGB",
    bitsPerComponent: bilevel ? 1 : 8,
    data: zlibSync(pixels, { level: 6 }),
    ...(alpha ? { alpha } : {}),
  };
}

/** Page size for an image: its physical size when the file has a DPI, else fit to Letter. */
export function imagePageSize(img: ImagePage): { width: number; height: number } {
  if (img.dpi && img.dpi.x >= 30 && img.dpi.y >= 30) {
    return { width: (img.width * 72) / img.dpi.x, height: (img.height * 72) / img.dpi.y };
  }
  const box = img.width > img.height ? { width: LETTER.height, height: LETTER.width } : LETTER;
  const s = Math.min(box.width / img.width, box.height / img.height);
  return { width: img.width * s, height: img.height * s };
}

/** A new PDF with one page per image, each image filling its page. */
export function imagesToPdf(images: ImagePage[]): Uint8Array {
  if (!images.length) throw new Error("no images");
  const w = new PdfWriter();
  const pagesRef = w.reserve();
  const kids: number[] = [];
  for (const img of images) {
    const { width, height } = imagePageSize(img);
    const smask = img.alpha
      ? w.stream(
          `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
          img.alpha,
        )
      : null;
    const image = w.stream(
      `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace /${img.colorSpace} /BitsPerComponent ${img.bitsPerComponent} /Filter /${img.filter}` +
        (img.extra ? ` ${img.extra}` : "") +
        (smask ? ` /SMask ${smask} 0 R` : ""),
      img.data,
    );
    const content = w.stream(
      "",
      new TextEncoder().encode(`q ${num(width)} 0 0 ${num(height)} 0 0 cm /Im0 Do Q`),
    );
    kids.push(
      w.object(
        `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] ` +
          `/Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  w.object(
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`,
    pagesRef,
  );
  const catalog = w.object(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
  return w.finish(catalog);
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** Just enough of a PDF writer for image pages: objects, streams, xref, trailer. */
class PdfWriter {
  private parts: Uint8Array[] = [];
  private length = 0;
  private offsets: number[] = [];
  private next = 1;
  private enc = new TextEncoder();

  constructor() {
    this.push(this.enc.encode("%PDF-1.7\n"));
    // Binary comment so transfer tools treat the file as binary.
    this.push(Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a));
  }

  reserve(): number {
    return this.next++;
  }

  object(body: string, id = this.reserve()): number {
    this.offsets[id] = this.length;
    this.push(this.enc.encode(`${id} 0 obj\n${body}\nendobj\n`));
    return id;
  }

  stream(dict: string, data: Uint8Array): number {
    const id = this.reserve();
    this.offsets[id] = this.length;
    this.push(this.enc.encode(`${id} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`));
    this.push(data);
    this.push(this.enc.encode("\nendstream\nendobj\n"));
    return id;
  }

  finish(root: number): Uint8Array {
    const xref = this.length;
    let table = `xref\n0 ${this.next}\n0000000000 65535 f \n`;
    for (let i = 1; i < this.next; i++)
      table += `${String(this.offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
    table += `trailer\n<< /Size ${this.next} /Root ${root} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    this.push(this.enc.encode(table));
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  private push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
}
