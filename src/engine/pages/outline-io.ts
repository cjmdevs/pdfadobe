// Read and write the bookmark tree of a PDF given as bytes, through EmbedPDF's engine.

import type { PdfDocumentObject } from "@embedpdf/models";
import type { Engine } from "../pdfium";
import { writable, type Outline } from "./outline";

let seq = 0;

/** Opens `bytes` in the engine, runs `fn`, and always closes the document. */
export async function withEngineDoc<T>(
  engine: Engine,
  bytes: Uint8Array,
  fn: (doc: PdfDocumentObject) => Promise<T>,
): Promise<T> {
  const content = bytes.slice().buffer;
  const doc = await engine.openDocumentBuffer({ id: `pages-${++seq}`, content }).toPromise();
  try {
    return await fn(doc);
  } finally {
    await engine.closeDocument(doc).toPromise();
  }
}

export async function readOutline(engine: Engine, bytes: Uint8Array): Promise<Outline> {
  return withEngineDoc(engine, bytes, async (doc) => {
    return (await engine.getBookmarks(doc).toPromise()).bookmarks;
  });
}

export async function pageCountOf(engine: Engine, bytes: Uint8Array): Promise<number> {
  return withEngineDoc(engine, bytes, async (doc) => doc.pageCount);
}

/** Replaces the whole bookmark tree. An empty tree removes /Outlines entries. */
export async function writeOutline(
  engine: Engine,
  bytes: Uint8Array,
  outline: Outline,
): Promise<Uint8Array> {
  return withEngineDoc(engine, bytes, async (doc) => {
    if (outline.length) await engine.setBookmarks(doc, writable(outline)).toPromise();
    else await engine.deleteBookmarks(doc).toPromise();
    return new Uint8Array(await engine.saveAsCopy(doc).toPromise());
  });
}
