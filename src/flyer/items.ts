// Workpaper items on the page (Phase 4): how they are tagged and found again, and the
// Stamp Summary rows and CSV. Every item is a standard annotation; our data rides in
// EmbedPDF's annotation custom data (stored in the PDF as the /EPDFCustom JSON string)
// under `pwType`, and its Subject reads "Tickmark: Footed". Node-safe, no React.

import { PdfAnnotationSubtype, type PdfAnnotationObject } from "@embedpdf/models";
import { sequenceNumber, type TickmarkDef } from "../engine/flyer/tickmarks";

export type PwType = "Tickmark" | "Legend";

/** What we keep on a workpaper annotation. */
export interface PwData {
  pwType: PwType;
  /** Tickmark id in the library (e.g. "footed"). */
  pwTick?: string;
  /** Sequence value placed ("B"), when the tickmark counts up. */
  pwLabel?: string;
}

export function pwData(a: PdfAnnotationObject): PwData | null {
  const c = (a as { custom?: unknown }).custom;
  if (!c || typeof c !== "object") return null;
  const t = (c as Record<string, unknown>).pwType;
  return t === "Tickmark" || t === "Legend" ? (c as PwData) : null;
}

export function tickmarkSubject(def: TickmarkDef, label?: string): string {
  return `Tickmark: ${def.name}${label ? ` (${label})` : ""}`;
}

/** Next value of a counting tickmark on this document: one past the highest placed. */
export function nextSequence(def: TickmarkDef, annots: PdfAnnotationObject[]): number {
  if (!def.sequence) return 0;
  let max = 0;
  for (const a of annots) {
    const d = pwData(a);
    if (d?.pwTick === def.id && d.pwLabel)
      max = Math.max(max, sequenceNumber(def.sequence, d.pwLabel));
  }
  return max + 1;
}

export interface SummaryRow {
  id: string;
  pageIndex: number;
  type: PwType;
  /** "Footed (B)" for tickmarks, "Tickmark legend". */
  name: string;
  meaning: string;
  author: string;
  created: Date | null;
  /** Points from the page's top-left corner. */
  x: number;
  y: number;
}

/** Every workpaper item, in page then top-to-bottom order. */
export function summaryRows(annots: PdfAnnotationObject[]): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const a of annots) {
    const d = pwData(a);
    if (!d || a.type !== PdfAnnotationSubtype.STAMP) continue;
    const subject = (a as { subject?: string }).subject ?? "";
    rows.push({
      id: a.id,
      pageIndex: a.pageIndex,
      type: d.pwType,
      name: d.pwType === "Tickmark" ? subject.replace(/^Tickmark: /, "") : "Tickmark legend",
      meaning: d.pwType === "Tickmark" ? (a.contents ?? "") : "",
      author: a.author ?? "",
      created: a.created ?? null,
      x: Math.round(a.rect.origin.x),
      y: Math.round(a.rect.origin.y),
    });
  }
  return rows.sort((p, q) => p.pageIndex - q.pageIndex || p.y - q.y || p.x - q.x);
}

const csvCell = (v: string) => {
  // Leading = + - @ would run as a formula in Excel.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function summaryCsv(rows: SummaryRow[], formatDate: (d: Date) => string): string {
  const head = ["Page", "Type", "Name", "Meaning", "Author", "Date", "X (pt)", "Y (pt)"];
  const body = rows.map((r) =>
    [
      String(r.pageIndex + 1),
      r.type,
      r.name,
      r.meaning,
      r.author,
      r.created ? formatDate(r.created) : "",
      String(r.x),
      String(r.y),
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...body].join("\r\n") + "\r\n";
}
