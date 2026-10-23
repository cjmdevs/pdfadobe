// Flatten markup into page content (Phase 3), always on a copy: the caller writes the
// result to a new file. Form fields, links, popups and redaction marks are left alone.
// Replies and review states of a flattened comment are removed with it (they would
// point at nothing). Node-safe.

import {
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
} from "@embedpdf/models";
import type { Engine } from "./pdfium";

const KEEP = new Set<PdfAnnotationSubtype>([
  PdfAnnotationSubtype.WIDGET,
  PdfAnnotationSubtype.LINK,
  PdfAnnotationSubtype.POPUP,
  PdfAnnotationSubtype.REDACT,
]);

export interface FlattenTarget {
  /** 0-based pages to flatten; omitted = every page. */
  pages?: number[];
  /** Only these annotations (ids = /NM); omitted = all markup on the pages. */
  ids?: string[];
}

export interface FlattenResult {
  bytes: Uint8Array;
  flattened: number;
}

/** Copy of `bytes` with the chosen markup drawn into the pages. */
export async function flattenMarkup(
  engine: Engine,
  bytes: Uint8Array,
  target: FlattenTarget = {},
): Promise<FlattenResult> {
  const content = bytes.slice().buffer;
  const doc: PdfDocumentObject = await engine
    .openDocumentBuffer({ id: `flatten-${crypto.randomUUID()}`, content })
    .toPromise();
  try {
    const wanted = target.ids ? new Set(target.ids) : null;
    let flattened = 0;
    for (const page of doc.pages) {
      if (target.pages && !target.pages.includes(page.index)) continue;
      const annots: PdfAnnotationObject[] = await engine.getPageAnnotations(doc, page).toPromise();
      const done = new Set<string>();
      for (const a of annots) {
        if (KEEP.has(a.type) || a.inReplyToId) continue;
        if (wanted && !wanted.has(a.id)) continue;
        // Hidden markup (e.g. review states without a parent) has nothing to draw.
        if (a.flags?.includes("hidden") || a.flags?.includes("noView")) continue;
        if (await engine.flattenAnnotation(doc, page, a).toPromise()) {
          done.add(a.id);
          flattened++;
        }
      }
      // Replies and states (any depth) of what was flattened.
      let removed = true;
      while (removed) {
        removed = false;
        for (const a of annots) {
          if (!a.inReplyToId || !done.has(a.inReplyToId) || done.has(a.id)) continue;
          await engine.removePageAnnotation(doc, page, a).toPromise();
          done.add(a.id);
          removed = true;
        }
      }
    }
    return { bytes: new Uint8Array(await engine.saveAsCopy(doc).toPromise()), flattened };
  } finally {
    await engine.closeDocument(doc).toPromise();
  }
}
