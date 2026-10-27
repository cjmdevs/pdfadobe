// Workpaper items on the page (Phase 4): how they are tagged and found again, and the
// Stamp Summary rows and CSV. Every item is a standard annotation; our data rides in
// EmbedPDF's annotation custom data (stored in the PDF as the /EPDFCustom JSON string)
// under `pwType`, and its Subject reads "Tickmark: Footed". Node-safe, no React.

import type { PdfAnnotationObject } from "@embedpdf/models";
import { sequenceNumber, type TickmarkDef } from "../engine/flyer/tickmarks";

export type PwType =
  | "Tickmark"
  | "Legend"
  | "Connector"
  /** The /Link over a cross-page connector marker (not listed anywhere). */
  | "ConnectorLink"
  | "UserStamp"
  | "StatusStamp"
  | "Note"
  /** Calculator tape. */
  | "Tape"
  /** The /Link over a letter/number tickmark to the next matching one (not listed). */
  | "TickLink";

const PW_TYPES: readonly PwType[] = [
  "Tickmark",
  "Legend",
  "Connector",
  "ConnectorLink",
  "UserStamp",
  "StatusStamp",
  "Note",
  "Tape",
  "TickLink",
];

/** How the Stamp Summary names each type. */
export const PW_TYPE_LABELS: Record<PwType, string> = {
  Tickmark: "Tickmark",
  Legend: "Legend",
  Connector: "Connector",
  ConnectorLink: "Connector link",
  UserStamp: "User stamp",
  StatusStamp: "Status stamp",
  Note: "Note",
  Tape: "Calculator tape",
  TickLink: "Tickmark link",
};

/** What we keep on a workpaper annotation. */
export interface PwData {
  pwType: PwType;
  /** Tickmark id in the library (e.g. "footed"). */
  pwTick?: string;
  /** Sequence value placed ("B"), when the tickmark counts up. */
  pwLabel?: string;
  /** Connector line: ids (/NM) of the annotations its ends are attached to. */
  pwFrom?: string;
  pwTo?: string;
  /** Cross-page connector: pair id, which end this is, and the other end's page (1-based). */
  pwPair?: string;
  pwEnd?: "start" | "end";
  pwPage?: number;
  /** User/status stamp template id. */
  pwStamp?: string;
  /** Letter/number tickmark: links to the next one with the same value. */
  pwLink?: boolean;
  /** TickLink: the tickmark it covers, the one it goes to, and where that one was. */
  pwOf?: string;
  pwNext?: string;
  pwAt?: string;
  /** Calculator tape lines, to open the tape in the calculator again. */
  pwTape?: { op: string; value: number; note?: string }[];
}

export function pwData(a: PdfAnnotationObject): PwData | null {
  const c = (a as { custom?: unknown }).custom;
  if (!c || typeof c !== "object") return null;
  const t = (c as Record<string, unknown>).pwType;
  return PW_TYPES.includes(t as PwType) ? (c as PwData) : null;
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

export interface NoteRow {
  id: string;
  pageIndex: number;
  text: string;
  author: string;
  date: Date | null;
  y: number;
}

/** Workpaper notes for the Notes panel, in page order. */
export function noteRows(annots: PdfAnnotationObject[]): NoteRow[] {
  return annots
    .filter((a) => pwData(a)?.pwType === "Note")
    .map((a) => ({
      id: a.id,
      pageIndex: a.pageIndex,
      text: a.contents ?? "",
      author: a.author ?? "",
      date: a.modified ?? a.created ?? null,
      y: a.rect.origin.y,
    }))
    .sort((p, q) => p.pageIndex - q.pageIndex || p.y - q.y);
}

export interface SummaryRow {
  id: string;
  pageIndex: number;
  type: PwType;
  /** "Footed (B)", "Tickmark legend", "Connector to page 5", "Prepared by". */
  name: string;
  /** Tickmark meaning, or the stamp's text (name, date, reference). */
  meaning: string;
  author: string;
  created: Date | null;
  /** Points from the page's top-left corner. */
  x: number;
  y: number;
}

function rowName(d: PwData, subject: string): string {
  switch (d.pwType) {
    case "Tickmark":
      return subject.replace(/^Tickmark: /, "");
    case "Legend":
      return "Tickmark legend";
    case "Tape":
      return "Calculator tape";
    case "Connector":
      return d.pwPage
        ? `Connector ${d.pwEnd === "end" ? "from" : "to"} page ${d.pwPage}`
        : "Connector";
    default:
      return subject;
  }
}

/** Every tickmark, legend, connector and user/status stamp (not notes: see noteRows), in
 * page then top-to-bottom order. */
export function summaryRows(annots: PdfAnnotationObject[]): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const a of annots) {
    const d = pwData(a);
    if (!d || d.pwType === "Note" || d.pwType === "ConnectorLink" || d.pwType === "TickLink")
      continue;
    const subject = (a as { subject?: string }).subject ?? "";
    rows.push({
      id: a.id,
      pageIndex: a.pageIndex,
      type: d.pwType,
      name: rowName(d, subject),
      meaning: d.pwType === "Legend" || d.pwType === "Connector" ? "" : (a.contents ?? ""),
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
      PW_TYPE_LABELS[r.type],
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
