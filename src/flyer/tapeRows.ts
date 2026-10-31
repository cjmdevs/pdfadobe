// Calculator tape on the page (backlog B6): PDFlyer's layout. A grey free text box in
// Courier 9 pt, one line per entry, "1 - 2 | note |  8.00 +" (section - line | note |
// amount op), each section opening with an empty line 0, as in the owner's PDFlyer
// sample. Being free text, Acrobat lists the tape as text. The same rows go in the
// annotation's custom data and, on save, in PDFlyer's /TapeData (engine/flyer/pdflyer.ts).
import {
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfFreeTextAnnoObject,
} from "@embedpdf/models";
import { formatAmount, type CalcDecimals, type TapeLine, type TapeOp } from "./calc";
import type { PwData } from "./items";

/** PDFlyer's subject for a tape. */
export const TAPE_SUBJECT = "Calculator Tape:PDFlyer";
export const TAPE_FONT_SIZE = 9;
export const TAPE_GREY = "#C0C0C0";
/** Acrobat's default style string, as PDFlyer writes it. */
export const TAPE_STYLE = 'font:"Courier New"; color:#000000; font-size:9pt;';
/** Print + LockedContents (the text is changed in the calculator, not typed over). */
export const TAPE_FLAGS = ["print", "lockedContents"] as const;

/** How each operation prints: T is an adding machine's total star; subtotal prints S
 * (the diamond is not in the PDF standard fonts). */
const PRINT: Record<TapeOp, string> = {
  "+": "+",
  "-": "-",
  "×": "×",
  "÷": "÷",
  "=": "=",
  T: "*",
  S: "S",
  G: "G",
  "": "",
  "#": "#",
  "@": "",
};

/** PDFlyer's /TapeData rows: [section, note, amount, op, decimals]. */
export function tapeData(tape: TapeLine[], decimals: CalcDecimals): string[][] {
  const dec = String(decimals);
  const rows: string[][] = [];
  let sec = 0;
  let n = 0;
  for (const l of tape) {
    const s = l.sec ?? 1;
    if (s !== sec) {
      sec = s;
      n = 0;
      rows.push([`${s} - 0`, "", "", "", dec]);
    }
    n++;
    const amount = l.op === "@" ? "" : formatAmount(l.value, decimals);
    rows.push([`${s} - ${n}`, l.note ?? "", amount, PRINT[l.op], dec]);
  }
  return rows;
}

/** The tape's text lines, columns lined up for a monospaced font. */
export function tapeLines(rows: string[][]): string[] {
  const w = (i: number) => Math.max(0, ...rows.map((r) => (r[i] ?? "").length));
  const [sw, nw, aw] = [w(0), w(1), w(2)];
  return rows.map(([sec = "", note = "", amount = "", op = ""]) =>
    `${sec.padEnd(sw)} | ${note.padEnd(nw)} | ${amount.padStart(aw)} ${op}`.trimEnd(),
  );
}

/** The box (points) the lines need in Courier 9 pt, with PDFium's padding. */
export function tapeBox(lines: string[]): { width: number; height: number } {
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return {
    width: Math.ceil(longest * TAPE_FONT_SIZE * 0.6 + 8),
    height: Math.ceil(Math.max(1, lines.length) * TAPE_FONT_SIZE * 1.07 + 6),
  };
}

const READ: Record<string, TapeOp> = {
  "+": "+",
  "-": "-",
  "×": "×",
  x: "×",
  "÷": "÷",
  "/": "÷",
  "=": "=",
  "*": "T",
  T: "T",
  S: "S",
  "◇": "S",
  G: "G",
  "#": "#",
};

/** Tape lines back from a tape's text (ours or PDFlyer's), to open it in the calculator.
 * Line 0 of a section and lines without an amount are skipped. */
export function parseTapeText(text: string): TapeLine[] {
  const out: TapeLine[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 3) continue;
    const sec = Number(/^(\d+)\s*-/.exec(parts[0] ?? "")?.[1] ?? 1);
    const m = /^(\(?-?[\d,]*\.?\d+\)?)\s*(\S*)$/.exec(parts.slice(2).join("|"));
    if (!m?.[1]) continue;
    const raw = m[1].replace(/,/g, "");
    const value = raw.startsWith("(") ? -Number(raw.slice(1, -1)) : Number(raw);
    if (!Number.isFinite(value)) continue;
    const note = parts[1] ?? "";
    out.push({
      op: READ[m[2] ?? ""] ?? "+",
      value,
      ...(note ? { note } : {}),
      ...(sec !== 1 ? { sec } : {}),
    });
  }
  return out;
}

/** The tape as a free text annotation with its top-left corner at `at` (page points,
 * from the top-left), kept on the page. */
export function tapeAnnotation(
  tape: TapeLine[],
  decimals: CalcDecimals,
  color: string,
  at: { pageIndex: number; x: number; y: number; page: { width: number; height: number } },
  author: string,
  id: string = crypto.randomUUID(),
): PdfFreeTextAnnoObject {
  const rows = tapeData(tape, decimals);
  const lines = tapeLines(rows);
  const box = tapeBox(lines);
  const x = Math.min(Math.max(0, at.x), Math.max(0, at.page.width - box.width));
  const y = Math.min(Math.max(0, at.y), Math.max(0, at.page.height - box.height));
  const now = new Date();
  return {
    type: PdfAnnotationSubtype.FREETEXT,
    id,
    pageIndex: at.pageIndex,
    rect: { origin: { x, y }, size: box },
    contents: lines.join("\n"),
    fontFamily: PdfStandardFont.Courier,
    fontSize: TAPE_FONT_SIZE,
    fontColor: "#000000",
    textAlign: PdfTextAlignment.Left,
    verticalAlign: PdfVerticalAlignment.Top,
    opacity: 1,
    color,
    backgroundColor: color,
    strokeColor: "#000000",
    strokeWidth: 1,
    defaultStyle: TAPE_STYLE,
    subject: TAPE_SUBJECT,
    author,
    created: now,
    modified: now,
    flags: [...TAPE_FLAGS],
    custom: { pwType: "Tape", pwTape: tape, pwTapeData: rows } satisfies PwData,
  };
}
