// Optimize, images: downsample colour and grey images above the preset's resolution and
// store them as JPEG. qpdf finds the image objects and decodes them (Flate, LZW and
// JPEG; --decode-level=all), we resample and encode, and qpdf writes the new streams
// back in place (--update-from-json), so page content is never regenerated.
//
// Left alone: black-and-white images (1 bit, CCITT, JBIG2), JPEG 2000, CMYK, indexed and
// spot-colour images, colour-key masks, custom /Decode arrays, and any image whose new
// version would not be clearly smaller.

import type { PdfiumModule } from "../pdfium";
import { RawDoc } from "../pages/raw";
import type { Qpdf } from "../pages/qpdf";
import { isDict, isRef, type JDict, type JVal, type PdfObjects } from "../redact/objects";
import { encodeJpeg } from "./jpeg";

export interface ImagePreset {
  /** Images shown above dpi x 1.5 are resampled down to dpi. */
  dpi: number;
  /** JPEG quality, 1-100. */
  quality: number;
}

interface Candidate {
  ref: string;
  dict: JDict;
  width: number;
  height: number;
  channels: 1 | 3;
  /** Already JPEG: re-encoded only when it is also resampled. */
  jpeg: boolean;
  length: number;
}

const SKIP_FILTERS = new Set(["/CCITTFaxDecode", "/JBIG2Decode", "/JPXDecode"]);

/** Number of colour channels we can re-encode (grey 1, RGB 3), or null. */
function channelsOf(objs: PdfObjects, cs: JVal | undefined): 1 | 3 | null {
  const v = objs.get(cs);
  if (v === "/DeviceGray" || v === "/CalGray") return 1;
  if (v === "/DeviceRGB" || v === "/CalRGB") return 3;
  if (Array.isArray(v)) {
    const [kind, arg] = v;
    if (kind === "/CalGray") return 1;
    if (kind === "/CalRGB") return 3;
    if (kind === "/ICCBased") {
      const n = objs.dict(arg)?.["/N"];
      return n === 1 ? 1 : n === 3 ? 3 : null;
    }
  }
  return null;
}

export function imageCandidates(objs: PdfObjects): Candidate[] {
  const out: Candidate[] = [];
  for (const ref of objs.refs()) {
    const d = objs.dict(ref);
    if (!d || d["/Subtype"] !== "/Image" || typeof d["/Length"] !== "number") continue;
    if (d["/ImageMask"] === true || d["/BitsPerComponent"] !== 8) continue;
    if (d["/Decode"] !== undefined || Array.isArray(objs.get(d["/Mask"]))) continue;
    const f = objs.get(d["/Filter"]);
    const filters = (Array.isArray(f) ? f : f === undefined ? [] : [f]).map(String);
    if (filters.some((x) => SKIP_FILTERS.has(x))) continue;
    const channels = channelsOf(objs, d["/ColorSpace"]);
    const width = d["/Width"];
    const height = d["/Height"];
    if (!channels || typeof width !== "number" || typeof height !== "number") continue;
    out.push({
      ref,
      dict: d,
      width,
      height,
      channels,
      jpeg: filters.at(-1) === "/DCTDecode",
      length: d["/Length"],
    });
  }
  return out;
}

/** Image XObject refs each page draws directly (resources inherited from /Pages). */
function pageXObjects(objs: PdfObjects): Map<string, number[]> {
  const where = new Map<string, number[]>();
  objs.pages().forEach((pageRef, i) => {
    let node: JDict | undefined = objs.dict(pageRef);
    let res: JDict | undefined;
    for (let depth = 0; node && depth < 32; depth++) {
      res = objs.dict(node["/Resources"]);
      if (res) break;
      node = objs.dict(node["/Parent"]);
    }
    const xo = objs.dict(res?.["/XObject"]);
    for (const v of Object.values(xo ?? {})) {
      if (isRef(v)) where.set(v, [...(where.get(v) ?? []), i]);
    }
  });
  return where;
}

interface Shown {
  width: number;
  height: number;
  dpi: number;
}

/** Every image drawn directly on each page, with the resolution it is shown at. */
function shownImages(m: PdfiumModule, bytes: Uint8Array): { pages: Shown[][]; size: number } {
  const doc = RawDoc.open(m, bytes);
  const meta = m.pdfium.wasmExports.malloc(28);
  const pages: Shown[][] = [];
  let size = 0;
  try {
    for (let i = 0; i < doc.pageCount; i++) {
      pages.push(
        doc.withPage(i, (page) => {
          size = Math.max(size, m.FPDF_GetPageWidthF(page), m.FPDF_GetPageHeightF(page));
          const list: Shown[] = [];
          const n = m.FPDFPage_CountObjects(page);
          for (let k = 0; k < n; k++) {
            const obj = m.FPDFPage_GetObject(page, k);
            if (m.FPDFPageObj_GetType(obj) !== 3) continue;
            if (!m.FPDFImageObj_GetImageMetadata(obj, page, meta)) continue;
            const u = (o: number) => m.pdfium.getValue(meta + o, "i32") >>> 0;
            const f = (o: number) => m.pdfium.getValue(meta + o, "float");
            list.push({ width: u(0), height: u(4), dpi: Math.min(f(8), f(12)) });
          }
          return list;
        }),
      );
    }
  } finally {
    m.pdfium.wasmExports.free(meta);
    doc.close();
  }
  return { pages, size };
}

/**
 * The resolution an image is shown at: the highest of its placements found on the pages
 * (so no placement drops below the target). An image only drawn inside a form gets a
 * safe low estimate: as if it filled the largest page.
 */
function shownDpi(
  c: Candidate,
  where: number[] | undefined,
  shown: { pages: Shown[][]; size: number },
): number {
  let best = 0;
  for (const p of where ?? []) {
    for (const s of shown.pages[p] ?? []) {
      if (s.width === c.width && s.height === c.height) best = Math.max(best, s.dpi);
    }
  }
  return best || Math.min(c.width, c.height) / (shown.size / 72);
}

/** Area-average resample of `ch`-channel pixels to `w2` x `h2`. */
export function resample(
  src: Uint8Array,
  w: number,
  h: number,
  ch: number,
  w2: number,
  h2: number,
): Uint8Array {
  const out = new Uint8Array(w2 * h2 * ch);
  const sx = w / w2;
  const sy = h / h2;
  const sum = new Float64Array(ch);
  for (let y = 0; y < h2; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w2; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) * sx)));
      sum.fill(0);
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * ch;
          for (let c = 0; c < ch; c++) sum[c] = (sum[c] ?? 0) + (src[i + c] ?? 0);
        }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * w2 + x) * ch;
      for (let c = 0; c < ch; c++) out[o + c] = Math.round((sum[c] ?? 0) / n);
    }
  }
  return out;
}

/** Decoded pixels of image objects, read in batches of about 64 MB. */
async function* decoded(
  qpdf: Qpdf,
  bytes: Uint8Array,
  list: Candidate[],
): AsyncGenerator<[Candidate, Uint8Array]> {
  const budget = 64 * 1024 * 1024;
  for (let i = 0; i < list.length;) {
    const batch: Candidate[] = [];
    let size = 0;
    while (i < list.length && (batch.length === 0 || size < budget)) {
      const c = list[i++] as Candidate;
      batch.push(c);
      size += c.width * c.height * c.channels;
    }
    const r = await qpdf.run({
      inputs: { "in0.pdf": bytes },
      args: [
        "--json=2",
        "--json-key=qpdf",
        "--json-stream-data=inline",
        "--decode-level=all",
        ...batch.map((c) => `--json-object=${c.ref.replace(/ (\d+) R$/, ",$1")}`),
        "in0.pdf",
      ],
      outputs: [],
    });
    const objects = (JSON.parse(r.stdout) as { qpdf: [JVal, Record<string, JVal>] }).qpdf[1];
    for (const c of batch) {
      const s = objects[`obj:${c.ref}`];
      const stream = isDict(s) && isDict(s["stream"]) ? s["stream"] : undefined;
      // Still filtered means qpdf could not decode it: leave it alone.
      if (!stream || typeof stream["data"] !== "string") continue;
      if (isDict(stream["dict"]) && stream["dict"]["/Filter"] !== undefined) continue;
      const bin = atob(stream["data"]);
      const px = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      if (px.length >= c.width * c.height * c.channels) yield [c, px];
    }
  }
}

export interface ImageReport {
  /** Images replaced by a smaller JPEG. */
  recompressed: number;
  /** Of those, resampled to a lower resolution. */
  downsampled: number;
}

const KEEP_OUT = new Set([
  "/Filter",
  "/DecodeParms",
  "/Length",
  "/Width",
  "/Height",
  "/ColorSpace",
  "/BitsPerComponent",
]);

/** Replaces images with smaller JPEGs in `objs` (written by the caller). */
export async function optimizeImages(
  m: PdfiumModule,
  qpdf: Qpdf,
  objs: PdfObjects,
  bytes: Uint8Array,
  preset: ImagePreset,
): Promise<ImageReport> {
  const report: ImageReport = { recompressed: 0, downsampled: 0 };
  const where = pageXObjects(objs);
  const shown = shownImages(m, bytes);
  const plan = imageCandidates(objs).flatMap((c) => {
    const dpi = shownDpi(c, where.get(c.ref), shown);
    const scale = dpi > preset.dpi * 1.5 ? preset.dpi / dpi : 1;
    // A JPEG that keeps its size would only lose quality.
    if (scale === 1 && c.jpeg) return [];
    return [{ c, scale }];
  });
  const scales = new Map(plan.map((p) => [p.c.ref, p.scale]));
  for await (const [c, px] of decoded(
    qpdf,
    bytes,
    plan.map((p) => p.c),
  )) {
    const scale = scales.get(c.ref) ?? 1;
    const w2 = Math.max(1, Math.round(c.width * scale));
    const h2 = Math.max(1, Math.round(c.height * scale));
    const pixels = scale < 1 ? resample(px, c.width, c.height, c.channels, w2, h2) : px;
    const jpeg = encodeJpeg(w2, h2, pixels, c.channels, preset.quality);
    if (jpeg.length > c.length * 0.9) continue;
    const dict: JDict = {};
    for (const [k, v] of Object.entries(c.dict)) if (!KEEP_OUT.has(k)) dict[k] = v;
    Object.assign(dict, {
      "/Width": w2,
      "/Height": h2,
      "/BitsPerComponent": 8,
      // Grey goes out as RGB (jpeg-js writes three channels); RGB keeps its colour space.
      "/ColorSpace": c.channels === 3 ? (c.dict["/ColorSpace"] ?? "/DeviceRGB") : "/DeviceRGB",
      "/Filter": "/DCTDecode",
    });
    objs.setStream(c.ref, dict, jpeg);
    report.recompressed++;
    if (scale < 1) report.downsampled++;
  }
  return report;
}
