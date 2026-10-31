// Headers and footers, Bates numbers, watermarks and backgrounds (Phase 7). Each is
// drawn with pdf-lib on a layer page the size of the displayed page and grafted onto
// the document as a form XObject marked with its kind (pages/graft.ts), in front of or
// behind the page's content. Adding a kind again replaces the old one; Remove takes it
// out. Like Acrobat, these are page content (not comments), so they print and survive
// flattening. Text uses the standard PDF fonts (no embedding needed).

import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PdfiumModule } from "../pdfium";
import type { Qpdf } from "../pages/qpdf";
import { graftLayers, pageFrames, removeGrafts, type PageFrame } from "../pages/graft";
import { sniffImage } from "../pages/images";

export type DecorKind = "header" | "bates" | "watermark" | "background";

export const STANDARD_FONTS = {
  Helvetica: StandardFonts.Helvetica,
  "Helvetica Bold": StandardFonts.HelveticaBold,
  "Times Roman": StandardFonts.TimesRoman,
  "Times Bold": StandardFonts.TimesRomanBold,
  Courier: StandardFonts.Courier,
  "Courier Bold": StandardFonts.CourierBold,
} as const;
export type FontName = keyof typeof STANDARD_FONTS;

export interface TextStyle {
  font: FontName;
  size: number;
  /** "#rrggbb" */
  color: string;
}

export type DateFormat = "M/D/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "MMMM D, YYYY";

export interface BatesSpec {
  prefix: string;
  start: number;
  digits: number;
  suffix: string;
}

export interface HeaderFooterSpec {
  /** Left, centre and right text. Tokens: {page} {pages} {date} {file} {bates}. */
  header: [string, string, string];
  footer: [string, string, string];
  style: TextStyle;
  /** Points from each edge of the displayed page. */
  margins: { top: number; bottom: number; left: number; right: number };
  /** 0-based pages; all pages when left out. */
  pages?: number[];
  /** The number {page} shows on the first page it is added to. */
  startNumber: number;
  dateFormat: DateFormat;
}

export interface WatermarkSpec {
  source: { text: string; style: TextStyle } | { image: Uint8Array; scale: number };
  /** 0 (invisible) to 1. */
  opacity: number;
  /** Degrees anticlockwise. */
  rotation: number;
  behind: boolean;
  /** Where its centre goes, then moved by dx, dy points (right, up). */
  position: {
    h: "left" | "center" | "right";
    v: "top" | "center" | "bottom";
    dx: number;
    dy: number;
  };
  pages?: number[];
}

export interface BackgroundSpec {
  source: { color: string } | { image: Uint8Array; scale: number };
  opacity: number;
  pages?: number[];
}

/** Values the tokens are filled with (passed in, so output is repeatable in tests). */
export interface TokenValues {
  fileName: string;
  date: Date;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatDate(d: Date, f: DateFormat): string {
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const two = (n: number) => String(n).padStart(2, "0");
  if (f === "MM/DD/YYYY") return `${two(mo)}/${two(day)}/${y}`;
  if (f === "YYYY-MM-DD") return `${y}-${two(mo)}-${two(day)}`;
  if (f === "MMMM D, YYYY") return `${MONTHS[mo - 1]} ${day}, ${y}`;
  return `${mo}/${day}/${y}`;
}

export function batesNumber(b: BatesSpec, n: number): string {
  return `${b.prefix}${String(n).padStart(Math.max(1, b.digits), "0")}${b.suffix}`;
}

/** Fills {page} {pages} {date} {file} {bates}. Unknown braces stay as typed. */
export function fillTokens(
  text: string,
  v: { page: number; pages: number; date: string; file: string; bates: string },
): string {
  return text.replace(/\{(page|pages|date|file|bates)\}/g, (_, k: keyof typeof v) => String(v[k]));
}

function hexColor(c: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  const n = (i: number) => parseInt(m?.[i] ?? "00", 16) / 255;
  return rgb(n(1), n(2), n(3));
}

/** Characters the standard font can't draw become "?". */
function encodable(font: PDFFont, s: string): string {
  const ok = new Set(font.getCharacterSet());
  return Array.from(s, (c) => (ok.has(c.codePointAt(0) ?? 0) ? c : "?")).join("");
}

const allPages = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Builds one layer page per target page and grafts them on as `kind`, replacing it. */
async function decorate(
  m: PdfiumModule,
  qpdf: Qpdf,
  bytes: Uint8Array,
  kind: DecorKind,
  pages: number[] | undefined,
  behind: boolean,
  draw: (
    layer: PDFDocument,
    page: PDFPage,
    frame: PageFrame,
    index: number,
    nth: number,
  ) => Promise<void>,
): Promise<Uint8Array> {
  const clean = (await removeGrafts(qpdf, bytes, [kind])).bytes;
  const frames = pageFrames(m, clean);
  const targets = (pages ?? allPages(frames.length)).filter((p) => p >= 0 && p < frames.length);
  const layer = await PDFDocument.create();
  for (const [nth, index] of targets.entries()) {
    const f = frames[index] as PageFrame;
    await draw(layer, layer.addPage([f.width, f.height]), f, index, nth);
  }
  return graftLayers(
    qpdf,
    clean,
    await layer.save({ useObjectStreams: false }),
    targets.map((page, i) => ({
      page,
      layerPage: i,
      behind,
      matrix: (frames[page] as PageFrame).toUser,
    })),
    kind,
  );
}

/** Headers and footers (kind "header"), or Bates numbers (kind "bates", with `bates`). */
export async function addHeaderFooter(
  m: PdfiumModule,
  qpdf: Qpdf,
  bytes: Uint8Array,
  spec: HeaderFooterSpec,
  values: TokenValues,
  bates?: BatesSpec,
): Promise<Uint8Array> {
  const fonts = new Map<PDFDocument, PDFFont>();
  const count = spec.pages?.length ?? pageFrames(m, bytes).length;
  const date = formatDate(values.date, spec.dateFormat);
  return decorate(
    m,
    qpdf,
    bytes,
    bates ? "bates" : "header",
    spec.pages,
    false,
    async (layer, page, f, _i, nth) => {
      let font = fonts.get(layer);
      if (!font) {
        font = await layer.embedFont(STANDARD_FONTS[spec.style.font]);
        fonts.set(layer, font);
      }
      const { size } = spec.style;
      const color = hexColor(spec.style.color);
      const tokens = {
        page: spec.startNumber + nth,
        pages: spec.startNumber + count - 1,
        date,
        file: values.fileName,
        bates: bates ? batesNumber(bates, bates.start + nth) : "",
      };
      const ascent = font.heightAtSize(size, { descender: false });
      const rows: [[string, string, string], number][] = [
        [spec.header, f.height - spec.margins.top - ascent],
        [spec.footer, spec.margins.bottom],
      ];
      for (const [texts, y] of rows) {
        texts.forEach((raw, col) => {
          const text = encodable(font, fillTokens(raw, tokens));
          if (!text.trim()) return;
          const w = font.widthOfTextAtSize(text, size);
          const x =
            col === 0
              ? spec.margins.left
              : col === 1
                ? (f.width - w) / 2
                : f.width - spec.margins.right - w;
          page.drawText(text, { x, y, size, font, color });
        });
      }
    },
  );
}

async function embedImage(layer: PDFDocument, image: Uint8Array) {
  const kind = sniffImage(image);
  if (kind === "jpeg") return layer.embedJpg(image);
  if (kind === "png") return layer.embedPng(image);
  throw new Error("use a JPEG or PNG image");
}

export async function addWatermark(
  m: PdfiumModule,
  qpdf: Qpdf,
  bytes: Uint8Array,
  spec: WatermarkSpec,
): Promise<Uint8Array> {
  return decorate(m, qpdf, bytes, "watermark", spec.pages, spec.behind, async (layer, page, f) => {
    const src = spec.source;
    // Size of what is drawn, before turning.
    let w: number;
    let h: number;
    let drawAt: (x: number, y: number) => void;
    if ("text" in src) {
      const font = await layer.embedFont(STANDARD_FONTS[src.style.font]);
      const text = encodable(font, src.text);
      w = font.widthOfTextAtSize(text, src.style.size);
      h = font.heightAtSize(src.style.size, { descender: false });
      drawAt = (x, y) =>
        page.drawText(text, {
          x,
          y,
          size: src.style.size,
          font,
          color: hexColor(src.style.color),
          opacity: spec.opacity,
          rotate: degrees(spec.rotation),
        });
    } else {
      const img = await embedImage(layer, src.image);
      // `scale`: the image's width as a share of the page width.
      w = f.width * src.scale;
      h = (img.height / img.width) * w;
      drawAt = (x, y) =>
        page.drawImage(img, {
          x,
          y,
          width: w,
          height: h,
          opacity: spec.opacity,
          rotate: degrees(spec.rotation),
        });
    }
    const a = (spec.rotation * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // Half the turned box, so a corner watermark stays on the page.
    const hw = (Math.abs(w * cos) + Math.abs(h * sin)) / 2;
    const hh = (Math.abs(w * sin) + Math.abs(h * cos)) / 2;
    const p = spec.position;
    const cx = (p.h === "left" ? hw : p.h === "right" ? f.width - hw : f.width / 2) + p.dx;
    const cy = (p.v === "bottom" ? hh : p.v === "top" ? f.height - hh : f.height / 2) + p.dy;
    // pdf-lib turns about the drawing origin (bottom-left): put the origin so the
    // centre lands on (cx, cy).
    drawAt(cx - (w / 2) * cos + (h / 2) * sin, cy - (w / 2) * sin - (h / 2) * cos);
  });
}

export async function addBackground(
  m: PdfiumModule,
  qpdf: Qpdf,
  bytes: Uint8Array,
  spec: BackgroundSpec,
): Promise<Uint8Array> {
  return decorate(m, qpdf, bytes, "background", spec.pages, true, async (layer, page, f) => {
    const src = spec.source;
    if ("color" in src) {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: f.width,
        height: f.height,
        color: hexColor(src.color),
        opacity: spec.opacity,
      });
      return;
    }
    const img = await embedImage(layer, src.image);
    const w = f.width * src.scale;
    const h = (img.height / img.width) * w;
    page.drawImage(img, {
      x: (f.width - w) / 2,
      y: (f.height - h) / 2,
      width: w,
      height: h,
      opacity: spec.opacity,
    });
  });
}

/** Removes the given kinds; returns the pages that had them. */
export async function removeDecorations(
  qpdf: Qpdf,
  bytes: Uint8Array,
  kinds: DecorKind[],
): Promise<{ bytes: Uint8Array; pages: number[] }> {
  return removeGrafts(qpdf, bytes, kinds);
}
