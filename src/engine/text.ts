// Text extraction with a guard for an EmbedPDF 2.15.1 bug: extractText() on a page
// with zero characters returns uninitialized WASM memory (garbage that could contain
// bytes from previously processed documents). We check the glyph count first.

import type { PdfDocumentObject } from "@embedpdf/models";
import type { Engine } from "./pdfium";

export async function pageText(
  engine: Engine,
  doc: PdfDocumentObject,
  pageIndex: number,
): Promise<string> {
  const page = doc.pages[pageIndex];
  if (!page) throw new RangeError(`page ${pageIndex} out of range`);
  const glyphs = await engine.getPageGlyphs(doc, page).toPromise();
  if (glyphs.length === 0) return "";
  return engine.extractText(doc, [pageIndex]).toPromise();
}

export async function documentText(engine: Engine, doc: PdfDocumentObject): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < doc.pageCount; i++) out.push(await pageText(engine, doc, i));
  return out;
}
