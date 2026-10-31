// Built-in text stamps (Phase 3; Acrobat's three sets since B6): Dynamic (Revised,
// Reviewed, Received, Approved, Confidential: they print who placed them and when), Sign
// Here and Standard Business. Each is drawn as a one-page PDF that becomes the stamp
// annotation's appearance stream (PDFium copies the page into /AP), so Acrobat shows
// exactly what we drew. Our own design; nothing from Adobe's stamp sets. Node-safe (the
// MCP server can stamp too).

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type StampSet = "dynamic" | "signHere" | "business";

export const STAMP_SETS: readonly { id: StampSet; label: string }[] = [
  { id: "dynamic", label: "Dynamic" },
  { id: "signHere", label: "Sign Here" },
  { id: "business", label: "Standard Business" },
];

export interface TextStampDef {
  id: string;
  title: string;
  /** "#rrggbb" */
  color: string;
  set: StampSet;
  /** Dynamic stamps: what they print. "byAt": "By carso at 11:55 am, Oct 28, 2026";
   * "time": "11:55 am, Oct 28, 2026"; "nameAbove": the user's name over the title. */
  dynamic?: "byAt" | "time" | "nameAbove";
  /** The standard stamp /Name (PDF 32000 12.5.6.12) when there is one. */
  pdfName?: string;
}

const BLUE = "#1F3A8A";
const GREEN = "#2E6B1F";
const RED = "#9B1C1C";
const s = (
  id: string,
  title: string,
  color: string,
  set: StampSet,
  more: Partial<TextStampDef> = {},
): TextStampDef => ({ id, title, color, set, ...more });

export const TEXT_STAMPS: readonly TextStampDef[] = [
  s("revised", "REVISED", BLUE, "dynamic", { dynamic: "time" }),
  s("reviewed", "REVIEWED", BLUE, "dynamic", { dynamic: "byAt" }),
  s("received", "RECEIVED", BLUE, "dynamic", { dynamic: "byAt" }),
  s("approved", "APPROVED", GREEN, "dynamic", { dynamic: "byAt", pdfName: "Approved" }),
  s("confidential", "CONFIDENTIAL", RED, "dynamic", {
    dynamic: "nameAbove",
    pdfName: "Confidential",
  }),
  s("signHere", "SIGN HERE", RED, "signHere", { pdfName: "SignHere" }),
  s("witness", "WITNESS", RED, "signHere", { pdfName: "Witness" }),
  s("initialHere", "INITIAL HERE", RED, "signHere", { pdfName: "InitialHere" }),
  s("accepted", "ACCEPTED", GREEN, "signHere", { pdfName: "Accepted" }),
  s("rejected", "REJECTED", RED, "signHere", { pdfName: "Rejected" }),
  s("approvedStd", "APPROVED", GREEN, "business", { pdfName: "Approved" }),
  s("notApproved", "NOT APPROVED", RED, "business", { pdfName: "NotApproved" }),
  s("draft", "DRAFT", RED, "business", { pdfName: "Draft" }),
  s("final", "FINAL", GREEN, "business", { pdfName: "Final" }),
  s("completed", "COMPLETED", GREEN, "business", { pdfName: "Completed" }),
  s("confidentialStd", "CONFIDENTIAL", RED, "business", { pdfName: "Confidential" }),
  s("forPublicRelease", "FOR PUBLIC RELEASE", BLUE, "business", {
    pdfName: "ForPublicRelease",
  }),
  s("notForPublicRelease", "NOT FOR PUBLIC RELEASE", RED, "business", {
    pdfName: "NotForPublicRelease",
  }),
  s("forComment", "FOR COMMENT", BLUE, "business", { pdfName: "ForComment" }),
  s("void", "VOID", RED, "business", { pdfName: "Void" }),
  s("preliminaryResults", "PRELIMINARY RESULTS", BLUE, "business", {
    pdfName: "PreliminaryResults",
  }),
  s("informationOnly", "INFORMATION ONLY", BLUE, "business", { pdfName: "InformationOnly" }),
];

export interface StampDrawing {
  /** One-page PDF, page size = stamp size. */
  pdf: Uint8Array;
  width: number;
  height: number;
}

const hex = (c: string) => {
  const n = parseInt(c.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** `c` mixed with white: a pale wash of the stamp's colour for its background. */
const pale = (c: string, k = 0.1) => {
  const n = parseInt(c.slice(1), 16);
  const mix = (v: number) => 1 - (1 - v / 255) * k;
  return rgb(mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255));
};

/** A rounded rectangle path (pdf-lib has none), y down from the top-left corner. */
function roundRect(w: number, h: number, r: number): string {
  return (
    `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} ` +
    `H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`
  );
}

/**
 * A stamp: the title in a rounded frame on a pale wash of its colour, and `detail` (the
 * dynamic text) in smaller type under it, or over it for "nameAbove". The text is fixed
 * when the stamp is placed.
 */
export async function drawTextStamp(def: TextStampDef, detail?: string): Promise<StampDrawing> {
  const doc = await PDFDocument.create();
  doc.setProducer("PDF Workbench");
  doc.setCreator("PDF Workbench");
  const title = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const small = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const titleSize = 20;
  const detailSize = def.dynamic === "nameAbove" ? 13 : 9;
  const padX = 10;
  const line = detail ? detail.slice(0, 80) : "";
  const titleW = title.widthOfTextAtSize(def.title, titleSize);
  const detailW = line ? small.widthOfTextAtSize(line, detailSize) : 0;
  const width = Math.ceil(Math.max(titleW, detailW) + padX * 2);
  const height = line ? (def.dynamic === "nameAbove" ? 52 : 46) : 34;
  const page = doc.addPage([width, height]);
  const color = hex(def.color);
  const inset = 1;
  page.drawSvgPath(roundRect(width - inset * 2, height - inset * 2, 6), {
    x: inset,
    y: height - inset,
    color: pale(def.color),
    borderColor: color,
    borderWidth: 1.25,
  });
  const above = def.dynamic === "nameAbove";
  const titleY = !line ? (height - titleSize * 0.7) / 2 : above ? 9 : height - 8 - titleSize * 0.75;
  page.drawText(def.title, { x: padX, y: titleY, size: titleSize, font: title, color });
  if (line)
    page.drawText(line, {
      x: padX,
      y: above ? height - 8 - detailSize * 0.75 : 8,
      size: detailSize,
      font: small,
      color,
    });
  return { pdf: await doc.save({ useObjectStreams: false }), width, height };
}

/** "11:55 am, Oct 28, 2026" in the user's locale. */
function timeDate(when: Date, locale?: string): string {
  const time = when
    .toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
    .replace(/\s?([AP])M$/i, (_, p: string) => ` ${p.toLowerCase()}m`);
  const date = when.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${time}, ${date}`;
}

/** What a dynamic stamp prints for `author` at `when`; undefined for the others. */
export function dynamicText(
  def: TextStampDef,
  author: string,
  when: Date,
  locale?: string,
): string | undefined {
  switch (def.dynamic) {
    case "byAt":
      return `By ${author} at ${timeDate(when, locale)}`;
    case "time":
      return timeDate(when, locale);
    case "nameAbove":
      return author;
    default:
      return undefined;
  }
}

/** The stamp's name in title case ("Sign Here"): its Subject, as Acrobat writes it. */
export function stampTitle(def: TextStampDef): string {
  return def.title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
