// User and status stamps (Phase 4 stage 2): "Prepared by", "Reviewed by", "Final" and the
// user's initials, with name, date/time, workpaper reference and custom fields. The
// values are fixed when the stamp is placed (like Acrobat's dynamic stamps, without
// JavaScript) and drawn as a one-page PDF that becomes the /Stamp appearance. Node-safe.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { StampDrawing } from "../stamps";
import { encodable, hexColor } from "./tickmarks";

export interface StampTemplate {
  id: string;
  /** "Prepared by"; drawn in capitals. */
  title: string;
  /** "status": sign-off stamps; "user": the initials stamp. */
  kind: "status" | "user";
  /** "#rrggbb" */
  color: string;
  showName: boolean;
  showDate: boolean;
  showTime: boolean;
  /** Asks for a workpaper reference when placed. */
  showRef: boolean;
  /** Labels of extra fields asked for when placed ("Client no."). */
  fields: string[];
}

export interface StampValues {
  name: string;
  initials: string;
  /** Date and time text as the user reads them. */
  date: string;
  time: string;
  ref: string;
  fields: Record<string, string>;
}

const tpl = (
  id: string,
  title: string,
  color: string,
  kind: "status" | "user" = "status",
): StampTemplate => ({
  id,
  title,
  kind,
  color,
  showName: kind === "status",
  showDate: true,
  showTime: kind === "status",
  showRef: kind === "status",
  fields: [],
});

export const BUILT_IN_STAMPS: readonly StampTemplate[] = [
  tpl("prepared", "Prepared by", "#1F4E9C"),
  tpl("reviewed", "Reviewed by", "#1E7B34"),
  tpl("final", "Final", "#B3261E"),
  tpl("initials", "Initials", "#1F4E9C", "user"),
];

/** "Jordan Q. Preparer" -> "JQP". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase())
    .join("")
    .slice(0, 4);
}

/** The lines under the title, as placed (also the annotation's comment text). */
export function stampLines(t: StampTemplate, v: StampValues): string[] {
  if (t.kind === "user") return [];
  const lines: string[] = [];
  if (t.showName) lines.push(v.initials ? `${v.name} (${v.initials})` : v.name);
  const when = [t.showDate ? v.date : "", t.showTime ? v.time : ""].filter(Boolean).join(" ");
  if (when) lines.push(when);
  if (t.showRef && v.ref) lines.push(`W/P ref: ${v.ref}`);
  for (const f of t.fields) if (v.fields[f]) lines.push(`${f}: ${v.fields[f]}`);
  return lines;
}

export async function drawUserStamp(t: StampTemplate, v: StampValues): Promise<StampDrawing> {
  const doc = await PDFDocument.create();
  doc.setProducer("PDF Workbench");
  doc.setCreator("PDF Workbench");
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const color = hexColor(t.color);
  const pad = 6;
  if (t.kind === "user") {
    // Initials big, the date small under them.
    const ini = encodable(bold, v.initials || "?");
    const date = encodable(regular, t.showDate ? v.date : "");
    const iw = bold.widthOfTextAtSize(ini, 16);
    const dw = date ? regular.widthOfTextAtSize(date, 7) : 0;
    const width = Math.ceil(Math.max(iw, dw) + pad * 2);
    const height = date ? 34 : 26;
    const page = doc.addPage([width, height]);
    page.drawRectangle({
      x: 0.75,
      y: 0.75,
      width: width - 1.5,
      height: height - 1.5,
      borderColor: color,
      borderWidth: 1.5,
    });
    page.drawText(ini, { x: (width - iw) / 2, y: height - 20, size: 16, font: bold, color });
    if (date) page.drawText(date, { x: (width - dw) / 2, y: 5, size: 7, font: regular, color });
    return { pdf: await doc.save({ useObjectStreams: false }), width, height };
  }
  const title = encodable(bold, t.title.toUpperCase());
  const lines = stampLines(t, v).map((l) => encodable(regular, l).slice(0, 70));
  const titleSize = 12;
  const size = 8;
  const width = Math.ceil(
    Math.max(
      bold.widthOfTextAtSize(title, titleSize),
      ...lines.map((l) => regular.widthOfTextAtSize(l, size)),
    ) +
      pad * 2 +
      4,
  );
  const height = Math.ceil(pad * 2 + titleSize + lines.length * (size + 2) + 2);
  const page = doc.addPage([width, height]);
  page.drawRectangle({
    x: 1,
    y: 1,
    width: width - 2,
    height: height - 2,
    borderColor: color,
    borderWidth: 2,
    color: rgb(1, 1, 1),
    opacity: 0,
    borderOpacity: 1,
  });
  page.drawText(title, {
    x: pad + 2,
    y: height - pad - titleSize * 0.8,
    size: titleSize,
    font: bold,
    color,
  });
  for (const [i, l] of lines.entries())
    page.drawText(l, {
      x: pad + 2,
      y: height - pad - titleSize - 2 - (i + 1) * (size + 2) + 2,
      size,
      font: regular,
      color,
    });
  return { pdf: await doc.save({ useObjectStreams: false }), width, height };
}

/** A cross-page connector end: an arrow and "p. 5" (the page of the other end). The
 * arrow points right at the start ("goes to") and left at the end ("comes from"). */
export async function drawConnectorMarker(
  otherPage: number,
  end: "start" | "end",
  color: string,
): Promise<StampDrawing> {
  const doc = await PDFDocument.create();
  doc.setProducer("PDF Workbench");
  doc.setCreator("PDF Workbench");
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const c = hexColor(color);
  const label = `p. ${otherPage}`;
  const size = 9;
  const arrowW = 16;
  const width = Math.ceil(arrowW + 4 + font.widthOfTextAtSize(label, size) + 6);
  const height = 16;
  const page = doc.addPage([width, height]);
  page.drawRectangle({
    x: 0.5,
    y: 0.5,
    width: width - 1,
    height: height - 1,
    borderColor: c,
    borderWidth: 1,
    color: rgb(1, 1, 1),
  });
  // Arrow head toward the text at the start, away from it at the end.
  const path =
    end === "start" ? "M 3 8 L 17 8 M 12 4 L 17 8 L 12 12" : "M 17 8 L 3 8 M 8 4 L 3 8 L 8 12";
  page.drawSvgPath(path, { x: 0, y: height, borderColor: c, borderWidth: 1.4 });
  page.drawText(label, { x: arrowW + 4, y: 4.5, size, font, color: c });
  return { pdf: await doc.save({ useObjectStreams: false }), width, height };
}
