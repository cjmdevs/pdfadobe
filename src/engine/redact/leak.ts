// The leak scan every redacted file passes before it is written (Phase 5). A hit means
// the save is refused. Three views of the finished file:
//   1. page text as PDFium extracts it (split runs re-join, case and spaces ignored);
//   2. every byte of the file and of every stream decoded by qpdf (metadata, form
//      values, annotations, bookmarks...), in the encodings a PDF writer uses;
//   3. a render of each box: it must show the plain fill (or blank paper), nothing else.
// OCR of the render runs in the test suite (tests/redaction); the app has no OCR yet.
//
// Hits name the secret by index, never by text, so an error can be logged safely.

import type { PdfiumModule } from "../pdfium";
import { heap, RawDoc } from "../pages/raw";
import { runToFile, type Qpdf } from "../pages/qpdf";
import { pageChars, type Rect } from "../edit/chars";
import type { OverlayOptions, PageRedaction } from "./apply";
import { norm } from "./sanitize";

export interface LeakHit {
  /** Index into the secrets list given to the scan. -1 for a box that shows content. */
  secret: number;
  where: "page-text" | "file-bytes" | "box-render";
  /** 0-based page for page-text and box-render hits. */
  pageIndex?: number;
  /** Encoding found, for file-bytes hits ("ascii", "utf16be-hex"...). */
  encoding?: string;
}

export class RedactionLeakError extends Error {
  constructor(readonly hits: LeakHit[]) {
    super(
      `Redaction check failed: ${hits.length} trace(s) of redacted content remain. ` +
        "The file was not saved.",
    );
    this.name = "RedactionLeakError";
  }
}

const enc = new TextEncoder();

function utf16be(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) >> 8;
    out[i * 2 + 1] = s.charCodeAt(i) & 0xff;
  }
  return out;
}

function hexOf(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Byte patterns a PDF writer might use to store `s`. */
export function encodings(s: string): { name: string; bytes: Uint8Array }[] {
  const latin = Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
  const wide = utf16be(s);
  const list = [
    { name: "ascii", bytes: latin },
    { name: "utf16be", bytes: wide },
    { name: "hex", bytes: enc.encode(hexOf(latin)) },
    { name: "hex", bytes: enc.encode(hexOf(latin).toUpperCase()) },
    { name: "utf16be-hex", bytes: enc.encode(hexOf(wide)) },
    { name: "utf16be-hex", bytes: enc.encode(hexOf(wide).toUpperCase()) },
  ];
  // A formatted number stored without its dashes or spaces (6+ digits: shorter runs
  // turn up by chance in image data and coordinates).
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 6 && digits !== s) list.push({ name: "digits", bytes: enc.encode(digits) });
  return list;
}

export function includesBytes(hay: Uint8Array, needle: Uint8Array): boolean {
  const n = needle.length;
  const first = needle[0];
  if (!n || first === undefined) return false;
  for (let i = hay.indexOf(first); i !== -1 && i <= hay.length - n; i = hay.indexOf(first, i + 1)) {
    let k = 1;
    while (k < n && hay[i + k] === needle[k]) k++;
    if (k === n) return true;
  }
  return false;
}

/** Every stream decoded, objects uncompressed (qpdf QDF mode). */
async function decoded(qpdf: Qpdf, bytes: Uint8Array): Promise<Uint8Array> {
  return runToFile(qpdf, {
    inputs: { "in0.pdf": bytes },
    args: ["--qdf", "--object-streams=disable", "--decode-level=all", "in0.pdf", "out.pdf"],
    outputs: ["out.pdf"],
  });
}

function pageTexts(m: PdfiumModule, doc: RawDoc): string[] {
  const out: string[] = [];
  for (let i = 0; i < doc.pageCount; i++) {
    out.push(
      doc.withPage(i, (page) => {
        const tp = m.FPDFText_LoadPage(page);
        try {
          return norm(
            pageChars(m, tp)
              .map((c) => c.ch)
              .join(""),
          );
        } finally {
          m.FPDFText_ClosePage(tp);
        }
      }),
    );
  }
  return out;
}

function hexColour(c: string): [number, number, number] {
  const v = /^#?([0-9a-f]{6})$/i.exec(c.trim())?.[1] ?? "000000";
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
}

const SCALE = 2;

/** Pixels inside `r` (inset 1 pt) further than anti-aliasing from `rgb`. */
function boxShowsContent(
  m: PdfiumModule,
  page: number,
  r: Rect,
  rgb: [number, number, number],
): boolean {
  const width = Math.round(m.FPDF_GetPageWidthF(page) * SCALE);
  const height = Math.round(m.FPDF_GetPageHeightF(page) * SCALE);
  const ex = m.pdfium.wasmExports;
  const xy = ex.malloc(8);
  const bmp = m.FPDFBitmap_Create(width, height, 1);
  try {
    m.FPDFBitmap_FillRect(bmp, 0, 0, width, height, 0xffffffff);
    // 0x01: draw annotations too; anything left over the box must not show.
    m.FPDF_RenderPageBitmap(bmp, page, 0, 0, width, height, 0, 0x01);
    const corner = (x: number, y: number) => {
      m.FPDF_PageToDevice(page, 0, 0, width, height, 0, x, y, xy, xy + 4);
      return [m.pdfium.getValue(xy, "i32"), m.pdfium.getValue(xy + 4, "i32")] as const;
    };
    const a = corner(r.l + 1, r.b + 1);
    const b = corner(r.r - 1, r.t - 1);
    const x0 = Math.max(0, Math.min(a[0], b[0]) + 1);
    const x1 = Math.min(width - 1, Math.max(a[0], b[0]) - 1);
    const y0 = Math.max(0, Math.min(a[1], b[1]) + 1);
    const y1 = Math.min(height - 1, Math.max(a[1], b[1]) - 1);
    const buf = m.FPDFBitmap_GetBuffer(bmp);
    const stride = m.FPDFBitmap_GetStride(bmp);
    const h = heap(m);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const s = buf + y * stride + x * 4; // BGRA
        const d =
          Math.abs((h[s + 2] ?? 0) - rgb[0]) +
          Math.abs((h[s + 1] ?? 0) - rgb[1]) +
          Math.abs((h[s] ?? 0) - rgb[2]);
        if (d > 24) return true;
      }
    }
    return false;
  } finally {
    m.FPDFBitmap_Destroy(bmp);
    ex.free(xy);
  }
}

/**
 * Scans a finished file. `secrets` are the strings that were redacted (never logged);
 * `boxes` and `overlay` drive the render check (skipped when the overlay has text).
 */
export async function leakScan(
  m: PdfiumModule,
  qpdf: Qpdf,
  bytes: Uint8Array,
  secrets: string[],
  boxes: PageRedaction[],
  overlay: OverlayOptions,
): Promise<LeakHit[]> {
  const hits: LeakHit[] = [];
  const keys = secrets.map(norm);
  const doc = RawDoc.open(m, bytes);
  try {
    pageTexts(m, doc).forEach((text, pageIndex) => {
      keys.forEach((k, secret) => {
        if (k && text.includes(k)) hits.push({ secret, where: "page-text", pageIndex });
      });
    });
    if (!overlay.text.trim()) {
      const rgb = overlay.fill
        ? hexColour(overlay.fill)
        : ([255, 255, 255] as [number, number, number]);
      for (const { pageIndex, rects } of boxes) {
        doc.withPage(pageIndex, (page) => {
          for (const r of rects) {
            if (r.r - r.l > 3 && r.t - r.b > 3 && boxShowsContent(m, page, r, rgb)) {
              hits.push({ secret: -1, where: "box-render", pageIndex });
              break;
            }
          }
        });
      }
    }
  } finally {
    doc.close();
  }
  const raw = [bytes, await decoded(qpdf, bytes)];
  secrets.forEach((s, secret) => {
    if (!s.trim()) return;
    for (const e of encodings(s)) {
      if (raw.some((r) => includesBytes(r, e.bytes))) {
        hits.push({ secret, where: "file-bytes", encoding: e.name });
        break;
      }
    }
  });
  return hits;
}
