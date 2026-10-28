// OCR of a rendered page for the redaction leak suite: Tesseract CLI (Apache-2.0).
// Found from $TESSERACT, PATH, or the default Windows install folder. Missing
// Tesseract is a test failure, never a skip: the suite must not pass without OCR.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { png } from "../corpus/generate.mjs";
import type { PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import { renderPage } from "./edit-render";

export function tesseractBin(): string {
  const candidates = [
    process.env.TESSERACT,
    "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
    "tesseract",
  ].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (c.includes("\\") && !existsSync(c)) continue;
    try {
      execFileSync(c, ["--version"], { stdio: "pipe" });
      return c;
    } catch {
      // try the next one
    }
  }
  throw new Error(
    "Tesseract not found. Install it (winget install UB-Mannheim.TesseractOCR) " +
      "or set TESSERACT to tesseract.exe.",
  );
}

/** Text Tesseract reads on each page, rendered at 300 dpi (two layout modes joined). */
export function ocrPages(m: PdfiumModule, bytes: Uint8Array): string[] {
  const bin = tesseractBin();
  const dir = mkdtempSync(join(tmpdir(), "pdfwb-ocr-"));
  const doc = RawDoc.open(m, bytes);
  try {
    const out: string[] = [];
    for (let i = 0; i < doc.pageCount; i++) {
      const r = renderPage(m, doc, i, 300 / 72);
      const file = join(dir, `p${i}.png`);
      writeFileSync(file, png(r.width, r.height, 6, r.data));
      // Two layouts: 6 (one block) reads ordinary pages; 11 (sparse text) still reads
      // a line that sits next to a big black box, where 6 can return nothing.
      const read = (psm: string) =>
        execFileSync(bin, [file, "stdout", "--psm", psm], { stdio: "pipe" }).toString();
      out.push([read("6"), read("11")].join("\n"));
    }
    return out;
  } finally {
    doc.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The fake SSN as OCR may read it: any spacing, dashes read as dashes, dots or spaces. */
export const OCR_SSN = /0\s*0\s*0\s*[-–—.\s]*1\s*2\s*[-–—.\s]*3\s*4\s*5\s*6/;
