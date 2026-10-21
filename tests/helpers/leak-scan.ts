// Independent checks that a string is gone from a PDF. Used by the redaction tests.
// Three extractors, so a bug in one library can't hide a leak:
//   1. PDFium (EmbedPDF) page text
//   2. pdf.js: page text, annotation contents/titles, form field values, /Info, XMP
//   3. Raw bytes after qpdf decompresses every stream, searched in several encodings

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Engine } from "../../src/engine/pdfium";
import { documentText } from "../../src/engine/text";
import { toArrayBuffer } from "./pdfium-node";

export interface PdfjsView {
  pageText: string[];
  annotations: { page: number; subtype: string; strings: string[] }[];
  info: Record<string, unknown>;
  xmp: string;
}

/** Text as pdf.js sees it. Items are joined without separators so split runs re-join. */
export async function pdfjsView(bytes: Uint8Array): Promise<PdfjsView> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const pageText: string[] = [];
  const annotations: PdfjsView["annotations"] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pageText.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(""));
    for (const a of await page.getAnnotations()) {
      const strings = [
        a.contents,
        a.titleObj?.str,
        a.contentsObj?.str,
        a.fieldValue,
        a.alternativeText,
      ]
        .flat()
        .filter((s): s is string => typeof s === "string");
      annotations.push({ page: i, subtype: String(a.subtype), strings });
    }
  }
  const meta = await doc.getMetadata();
  const xmp = meta.metadata ? String(meta.metadata.getRaw()) : "";
  await task.destroy();
  return { pageText, annotations, info: meta.info as Record<string, unknown>, xmp };
}

/** Every stream decompressed, objects uncompressed (qpdf QDF mode). */
export function decompressedBytes(bytes: Uint8Array): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "pdfwb-leak-"));
  try {
    const inp = join(dir, "in.pdf");
    const out = join(dir, "out.pdf");
    writeFileSync(inp, bytes);
    try {
      execFileSync("qpdf", ["--qdf", "--object-streams=disable", "--decode-level=all", inp, out], {
        stdio: "pipe",
      });
    } catch (e) {
      // qpdf exits 3 for warnings but still writes output.
      if ((e as { status?: number }).status !== 3) throw e;
    }
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Byte patterns a PDF writer might use to store `s`. */
export function encodings(s: string): { name: string; bytes: Buffer }[] {
  const ascii = Buffer.from(s, "latin1");
  const utf16be = Buffer.from(s, "utf16le").swap16();
  const hex = (b: Buffer) => b.toString("hex");
  const digits = s.replace(/\D/g, "");
  const list = [
    { name: "ascii", bytes: ascii },
    { name: "utf16be", bytes: utf16be },
    { name: "hex-lower", bytes: Buffer.from(hex(ascii)) },
    { name: "hex-upper", bytes: Buffer.from(hex(ascii).toUpperCase()) },
    { name: "utf16be-hex-lower", bytes: Buffer.from(hex(utf16be)) },
    { name: "utf16be-hex-upper", bytes: Buffer.from(hex(utf16be).toUpperCase()) },
  ];
  if (digits && digits !== s) list.push({ name: "digits-only", bytes: Buffer.from(digits) });
  return list;
}

export function rawHits(bytes: Uint8Array, needle: string): string[] {
  const raw = Buffer.concat([Buffer.from(bytes), decompressedBytes(bytes)]);
  return encodings(needle)
    .filter((e) => raw.includes(e.bytes))
    .map((e) => e.name);
}

export async function pdfiumText(engine: Engine, bytes: Uint8Array): Promise<string[]> {
  const doc = await engine
    .openDocumentBuffer({ id: `leak-${Math.random()}`, content: toArrayBuffer(bytes) })
    .toPromise();
  try {
    return await documentText(engine, doc);
  } finally {
    await engine.closeDocument(doc).toPromise();
  }
}
