// Incremental updates (PDF 32000 7.5.6): new versions of a few objects appended after
// the original bytes, which stay exactly as they were. Signing needs this: an earlier
// signature covers the bytes before it, so the file must never be rewritten.
//
// Values come from qpdf's JSON v2 (`PdfObjects`) and are written back as PDF syntax.
// The cross-reference section matches the original's kind: a table after a table, an
// uncompressed cross-reference stream after a stream.

import type { JDict, JVal } from "../redact/objects";

const enc = new TextEncoder();

/** A qpdf JSON v2 value as PDF syntax. */
export function pdfValue(v: JVal): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return pdfNumber(v);
  if (Array.isArray(v)) return `[${v.map(pdfValue).join(" ")}]`;
  if (typeof v === "object") {
    return `<<${Object.entries(v)
      .map(([k, x]) => `${pdfName(k)} ${pdfValue(x)}`)
      .join(" ")}>>`;
  }
  if (/^\d+ \d+ R$/.test(v)) return v;
  if (v.startsWith("/")) return pdfName(v);
  if (v.startsWith("n:")) return v.slice(2);
  if (v.startsWith("b:")) return `<${v.slice(2)}>`;
  if (v.startsWith("u:")) return pdfText(v.slice(2));
  throw new Error("unknown value in the document's objects");
}

export function pdfNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** "/Name" with anything outside the regular characters written as #xx. */
export function pdfName(name: string): string {
  const body = name.startsWith("/") ? name.slice(1) : name;
  let out = "/";
  for (const b of enc.encode(body)) {
    const c = String.fromCharCode(b);
    out += b < 0x21 || b > 0x7e || "()<>[]{}/%#".includes(c) ? `#${hex2(b)}` : c;
  }
  return out;
}

/** A text string: a literal for plain ASCII, UTF-16BE with a byte-order mark otherwise. */
export function pdfText(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let h = "FEFF";
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${h.toUpperCase()}>`;
}

const hex2 = (b: number) => b.toString(16).padStart(2, "0").toUpperCase();

/** One object of the update: a dictionary/array/value, or a stream. */
export interface UpdateObject {
  num: number;
  value?: JVal;
  stream?: { dict: JDict; data: Uint8Array };
}

/** Byte offset of the last cross-reference section (the final `startxref`). */
export function lastXref(bytes: Uint8Array): number {
  const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  const m =
    /startxref\s+(\d+)\s*(?:%%EOF)?\s*$/.exec(tail) ??
    [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!m?.[1]) throw new Error("the document has no cross-reference offset");
  return Number(m[1]);
}

function xrefIsStream(bytes: Uint8Array, at: number): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(at, at + 32));
  return !/^\s*xref/.test(head);
}

/**
 * Appends `objects` to `original` as one incremental update. `trailer` carries /Root,
 * /Info and /ID from the current trailer; /Size and /Prev are filled in here.
 */
export function appendUpdate(
  original: Uint8Array,
  objects: UpdateObject[],
  trailer: JDict,
  size: number,
): Uint8Array {
  const prev = lastXref(original);
  const asStream = xrefIsStream(original, prev);
  const parts: Uint8Array[] = [original];
  let length = original.length;
  const push = (b: Uint8Array | string) => {
    const u = typeof b === "string" ? enc.encode(b) : b;
    parts.push(u);
    length += u.length;
  };
  const last = original[original.length - 1];
  if (last !== 0x0a && last !== 0x0d) push("\n");

  const offsets = new Map<number, number>();
  for (const o of objects) {
    offsets.set(o.num, length);
    if (o.stream) {
      const dict = { ...o.stream.dict, "/Length": o.stream.data.length };
      push(`${o.num} 0 obj\n${pdfValue(dict)}\nstream\n`);
      push(o.stream.data);
      push("\nendstream\nendobj\n");
    } else push(`${o.num} 0 obj\n${pdfValue(o.value ?? null)}\nendobj\n`);
  }

  const keep: JDict = {};
  for (const k of ["/Root", "/Info", "/ID"]) if (trailer[k] !== undefined) keep[k] = trailer[k];

  if (asStream) {
    const num = Math.max(size, ...objects.map((o) => o.num + 1));
    offsets.set(num, length);
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    const rows = new Uint8Array(nums.length * 6);
    nums.forEach((n, i) => {
      const off = offsets.get(n) ?? 0;
      rows.set([1, (off >>> 24) & 255, (off >>> 16) & 255, (off >>> 8) & 255, off & 255, 0], i * 6);
    });
    const dict: JDict = {
      ...keep,
      "/Type": "/XRef",
      "/Size": num + 1,
      "/Index": subsections(nums).flatMap(([s, c]) => [s, c]),
      "/W": [1, 4, 1],
      "/Prev": prev,
      "/Length": rows.length,
    };
    push(`${num} 0 obj\n${pdfValue(dict)}\nstream\n`);
    push(rows);
    push(`\nendstream\nendobj\nstartxref\n${offsets.get(num)}\n%%EOF\n`);
  } else {
    const at = length;
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    let table = "xref\n";
    for (const [start, count] of subsections(nums)) {
      table += `${start} ${count}\n`;
      for (let n = start; n < start + count; n++) {
        table += `${String(offsets.get(n)).padStart(10, "0")} 00000 n\r\n`;
      }
    }
    const t: JDict = {
      ...keep,
      "/Size": Math.max(size, (nums[nums.length - 1] ?? 0) + 1),
      "/Prev": prev,
    };
    push(`${table}trailer\n${pdfValue(t)}\nstartxref\n${at}\n%%EOF\n`);
  }

  const out = new Uint8Array(length);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Consecutive runs of object numbers: [first, count]. */
function subsections(nums: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const n of nums) {
    const cur = out[out.length - 1];
    if (cur && cur[0] + cur[1] === n) cur[1]++;
    else out.push([n, 1]);
  }
  return out;
}
