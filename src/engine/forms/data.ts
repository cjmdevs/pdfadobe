// Form data files (Phase 6): FDF and XFDF (what Acrobat's Prepare Form > Export/Import
// Data writes and reads), JSON, and CSV (one row per filled copy). Values are client
// data: they are never logged and never put in a file name without the user choosing
// the column. Node-safe.
//
// Button values: FDF and XFDF carry the stored state name (/V), as Acrobat does; JSON
// and CSV carry what the user sees (the /Opt label when the field has one). Import takes
// either, since planFill matches both.

import { XMLParser } from "fast-xml-parser";
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFParser,
  PDFString,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";
import type { FieldValues } from "./fill";
import type { FormField } from "./fields";

export type DataFormat = "fdf" | "xfdf" | "json" | "csv";

export class FormDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormDataError";
  }
}

const BUTTONS = new Set(["checkbox", "radio"]);
const exportable = (f: FormField) =>
  f.kind !== "signature" && f.kind !== "button" && f.kind !== "unknown";

/** name -> value of every exportable field. "raw": buttons as their stored state name. */
export function valuesOf(fields: FormField[], style: "raw" | "label"): FieldValues {
  const out: FieldValues = {};
  for (const f of fields) {
    if (!exportable(f)) continue;
    if (style === "raw" && BUTTONS.has(f.kind)) {
      out[f.name] = f.widgets.find((w) => w.label === f.value)?.exportValue ?? "Off";
    } else out[f.name] = f.value;
  }
  return out;
}

export function formatOf(fileName: string): DataFormat | null {
  const ext = /\.([a-z]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return ext === "fdf" || ext === "xfdf" || ext === "json" || ext === "csv" ? ext : null;
}

// ---- Field name tree (FDF and XFDF nest partial names) -------------------------------

interface NameNode {
  kids: Map<string, NameNode>;
  value?: string;
}

function nameTree(values: FieldValues): NameNode {
  const root: NameNode = { kids: new Map() };
  for (const [name, value] of Object.entries(values)) {
    let node = root;
    for (const part of name.split(".")) {
      let next = node.kids.get(part);
      if (!next) node.kids.set(part, (next = { kids: new Map() }));
      node = next;
    }
    node.value = value;
  }
  return root;
}

// ---- FDF ----------------------------------------------------------------------------

function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${hex.toUpperCase()}>`;
}

function pdfName(s: string): string {
  let out = "/";
  for (const b of new TextEncoder().encode(s)) {
    const c = String.fromCharCode(b);
    out +=
      b > 0x20 && b < 0x7f && !"#()<>[]{}/%".includes(c)
        ? c
        : `#${b.toString(16).padStart(2, "0")}`;
  }
  return out;
}

/** FDF 1.2 with the field hierarchy as /Kids, like Acrobat's Export Data. */
export function toFdf(values: FieldValues, buttons: Set<string>, pdfFileName: string): string {
  const write = (node: NameNode, part: string, path: string): string => {
    const items: string[] = [`/T ${pdfString(part)}`];
    if (node.value !== undefined)
      items.push(`/V ${buttons.has(path) ? pdfName(node.value) : pdfString(node.value)}`);
    if (node.kids.size)
      items.push(
        `/Kids [${[...node.kids].map(([k, n]) => write(n, k, path ? `${path}.${k}` : k)).join(" ")}]`,
      );
    return `<< ${items.join(" ")} >>`;
  };
  const root = nameTree(values);
  const fields = [...root.kids].map(([k, n]) => write(n, k, k)).join("\n");
  return (
    "%FDF-1.2\n%âãÏÓ\n1 0 obj\n<< /FDF << /F " +
    `${pdfString(pdfFileName)} /Fields [\n${fields}\n] >> >>\nendobj\n` +
    "trailer\n<< /Root 1 0 R >>\n%%EOF\n"
  );
}

function decode(ctx: PDFContext, o: PDFObject | undefined): string | undefined {
  const v = o ? ctx.lookup(o) : undefined;
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  if (v instanceof PDFName) return v.decodeText();
  if (v instanceof PDFArray) return decode(ctx, v.get(0));
  return undefined;
}

export async function parseFdf(bytes: Uint8Array): Promise<FieldValues> {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  const at = head.indexOf("%FDF-");
  if (at < 0) throw new FormDataError("this is not an FDF file");
  // pdf-lib reads PDF syntax; an FDF is the same syntax with another header.
  const copy = bytes.slice();
  copy.set(new TextEncoder().encode("%PDF-"), at);
  let ctx: PDFContext;
  try {
    ctx = await PDFParser.forBytesWithOptions(copy).parseDocument();
  } catch {
    throw new FormDataError("the FDF file is damaged");
  }
  const root = ctx.lookup(ctx.trailerInfo.Root);
  const fdf = root instanceof PDFDict ? root.lookup(PDFName.of("FDF")) : undefined;
  const fields = fdf instanceof PDFDict ? fdf.lookup(PDFName.of("Fields")) : undefined;
  if (!(fields instanceof PDFArray)) throw new FormDataError("the FDF file has no form fields");
  const out: FieldValues = {};
  const walk = (o: PDFObject, prefix: string, depth: number) => {
    const d = ctx.lookup(o);
    if (!(d instanceof PDFDict) || depth > 64) return;
    const t = decode(ctx, d.get(PDFName.of("T")));
    const name = t === undefined ? prefix : prefix ? `${prefix}.${t}` : t;
    const v = decode(ctx, d.get(PDFName.of("V")));
    if (v !== undefined && name) out[name] = v;
    const kids = d.lookup(PDFName.of("Kids"));
    if (kids instanceof PDFArray) for (const k of kids.asArray()) walk(k, name, depth + 1);
  };
  for (const f of fields.asArray()) walk(f, "", 0);
  return out;
}

// ---- XFDF ---------------------------------------------------------------------------

const ENTITY: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" };
const xml = (s: string) => s.replace(/[<>&"]/g, (c) => ENTITY[c] ?? c);

export function toXfdf(values: FieldValues, pdfFileName: string): string {
  const write = (node: NameNode, part: string, indent: string): string => {
    const inner: string[] = [];
    if (node.value !== undefined) inner.push(`${indent}  <value>${xml(node.value)}</value>`);
    for (const [k, n] of node.kids) inner.push(write(n, k, `${indent}  `));
    return `${indent}<field name="${xml(part)}">\n${inner.join("\n")}\n${indent}</field>`;
  };
  const root = nameTree(values);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">\n' +
    `  <f href="${xml(pdfFileName)}"/>\n  <fields>\n` +
    [...root.kids].map(([k, n]) => write(n, k, "    ")).join("\n") +
    "\n  </fields>\n</xfdf>\n"
  );
}

interface XField {
  name?: string;
  value?: unknown;
  field?: XField[];
}

const textOf = (v: unknown): string | undefined => {
  if (Array.isArray(v)) return textOf(v[0]);
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v)
    return String((v as { "#text": unknown })["#text"]);
  if (v === "") return "";
  return v === undefined ? undefined : "";
};

export function parseXfdfFields(text: string): FieldValues {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
    removeNSPrefix: true,
    processEntities: true,
    isArray: (name) => name === "field" || name === "value",
  });
  let doc: { xfdf?: { fields?: { field?: XField[] } } };
  try {
    doc = parser.parse(text) as typeof doc;
  } catch {
    throw new FormDataError("the XFDF file is not valid XML");
  }
  if (!doc.xfdf) throw new FormDataError("this is not an XFDF file");
  const out: FieldValues = {};
  const walk = (f: XField, prefix: string, depth: number) => {
    if (depth > 64) return;
    const name = f.name === undefined ? prefix : prefix ? `${prefix}.${f.name}` : f.name;
    const v = textOf(f.value);
    if (v !== undefined && name) out[name] = v;
    for (const k of f.field ?? []) walk(k, name, depth + 1);
  };
  for (const f of doc.xfdf.fields?.field ?? []) walk(f, "", 0);
  return out;
}

// ---- JSON ---------------------------------------------------------------------------

export function toJson(values: FieldValues, pdfFileName: string): string {
  return `${JSON.stringify({ document: pdfFileName, fields: values }, null, 2)}\n`;
}

/** `{ "fields": { name: value } }` (our export) or a plain `{ name: value }` object. */
export function parseJsonFields(text: string): FieldValues {
  let doc: unknown;
  try {
    doc = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new FormDataError("the JSON file is not valid JSON");
  }
  const obj =
    doc && typeof doc === "object" && "fields" in doc ? (doc as { fields: unknown }).fields : doc;
  if (!obj || typeof obj !== "object" || Array.isArray(obj))
    throw new FormDataError('the JSON file needs an object of field names and values ("fields")');
  const out: FieldValues = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") throw new FormDataError(`the value of "${k}" is not plain text`);
    out[k] = typeof v === "boolean" ? (v ? "Yes" : "Off") : String(v);
  }
  return out;
}

// ---- CSV ----------------------------------------------------------------------------

const needsQuotes = /[",\r\n]|^\s|\s$/;
const cell = (s: string) => (needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Header row of field names, then one row per copy. UTF-8 with a BOM so Excel reads it. */
export function toCsv(names: string[], rows: FieldValues[]): string {
  const lines = [names.map(cell).join(",")];
  for (const r of rows) lines.push(names.map((n) => cell(r[n] ?? "")).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export interface CsvTable {
  names: string[];
  rows: string[][];
}

/** RFC 4180 CSV (quotes, doubled quotes, line breaks in quotes). Comma, semicolon or tab. */
export function parseCsv(text: string): CsvTable {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const sep = [",", ";", "\t"].reduce((a, b) => (count(b) > count(a) ? b : a), ",");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    records.push(row);
    row = [];
  };
  while (i < src.length) {
    const c = src.charAt(i);
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === sep) endField();
    else if (c === "\n") endRow();
    else if (c === "\r") {
      if (src[i + 1] !== "\n") endRow();
    } else field += c;
    i++;
  }
  if (quoted) throw new FormDataError("the CSV file has an unclosed quote");
  if (field !== "" || row.length) endRow();
  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ""));
  const [head, ...rows] = nonEmpty;
  if (!head) throw new FormDataError("the CSV file is empty");
  const names = head.map((h) => h.trim());
  if (names.some((n) => !n)) throw new FormDataError("a column in the CSV header has no name");
  const dup = names.find((n, k) => names.indexOf(n) !== k);
  if (dup) throw new FormDataError(`the CSV header names "${dup}" twice`);
  return { names, rows: rows.map((r) => names.map((_, k) => r[k] ?? "")) };
}

/**
 * The values of one CSV row. An empty cell leaves its field alone (a blank in a
 * spreadsheet is "nothing to fill", not "erase what is there").
 */
export function csvRowValues(table: CsvTable, row: number): FieldValues {
  const out: FieldValues = {};
  const r = table.rows[row];
  if (!r) return out;
  table.names.forEach((n, k) => {
    const v = r[k] ?? "";
    if (v !== "") out[n] = v;
  });
  return out;
}

// ---- One entry point for import -------------------------------------------------------

/** The rows a data file holds: FDF, XFDF and JSON hold one, CSV one per data row. */
export async function parseFormData(bytes: Uint8Array, format: DataFormat): Promise<FieldValues[]> {
  if (format === "fdf") return [await parseFdf(bytes)];
  const text = new TextDecoder().decode(bytes);
  if (format === "xfdf") return [parseXfdfFields(text)];
  if (format === "json") return [parseJsonFields(text)];
  const table = parseCsv(text);
  return table.rows.map((_, k) => csvRowValues(table, k));
}
