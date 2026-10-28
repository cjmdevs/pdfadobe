// Redaction and Sanitize (Phase 5): the whole Apply in one call. Node-safe.
//
//   1. page content: text, images, vectors under the boxes; overlay drawn (apply.ts)
//   2. annotations and whole form fields under the boxes (objects.ts)
//   3. XMP, thumbnails, XFA, /Info and tagged text holding a redacted string (sanitize.ts)
//   4. optional Sanitize Document
//   5. qpdf full rewrite: no unreferenced objects, no earlier revisions
//   6. leak scan of the finished bytes; any hit throws RedactionLeakError (leak.ts)
//
// The caller writes the result to a NEW file ("<name>_Redacted.pdf"), never over the
// original and never as an incremental save.

import type { PdfiumModule } from "../pdfium";
import type { Qpdf } from "../pages/qpdf";
import {
  DEFAULT_OVERLAY,
  redactContent,
  type ContentReport,
  type OverlayOptions,
  type PageRedaction,
} from "./apply";
import { PdfObjects, removeUnderMarks, rewrite, type ObjectsReport } from "./objects";
import {
  EMPTY_SANITIZE_REPORT,
  removeHiddenText,
  sanitizeObjects,
  scrubAfterRedaction,
  type SanitizeOptions,
  type SanitizeReport,
} from "./sanitize";
import { leakScan, RedactionLeakError } from "./leak";

export * from "./patterns";
export * from "./search";
export { DEFAULT_OVERLAY, type OverlayOptions, type PageRedaction } from "./apply";
export { ALL_SANITIZE, type SanitizeOptions, type SanitizeReport } from "./sanitize";
export { RedactionLeakError, type LeakHit } from "./leak";

export interface RedactRequest {
  marks: PageRedaction[];
  /** Text the search found under the marks (exact strings). Never logged. */
  found: string[];
  overlay?: OverlayOptions;
  /** Also run Sanitize Document. */
  sanitize?: SanitizeOptions | null;
}

export interface RedactResult {
  bytes: Uint8Array;
  content: ContentReport;
  objects: ObjectsReport;
  sanitize: SanitizeReport;
  /** Strings the leak scan checked for. Never logged. */
  secrets: string[];
}

/**
 * What the leak scan looks for: every search hit, plus each run of 6+ digits that was
 * under an area or page box (SSNs, account numbers). Words under an area box are not
 * checked: the same word elsewhere on purpose (a name in a heading) would block saving.
 */
export function secretsFor(found: string[], removed: ContentReport["removedText"]): string[] {
  const out = new Set<string>();
  for (const f of found) if (f.trim().length >= 4) out.add(f.trim());
  for (const { text } of removed) {
    for (const tok of text.split(/\s+/)) {
      const t = tok.replace(/^[^\d]+|[^\d]+$/g, "");
      if (t.replace(/\D/g, "").length >= 6) out.add(t);
    }
  }
  return [...out];
}

export async function redactDocument(
  m: PdfiumModule,
  qpdf: Qpdf,
  original: Uint8Array,
  req: RedactRequest,
): Promise<RedactResult> {
  const overlay = req.overlay ?? DEFAULT_OVERLAY;
  const { bytes: afterContent, report: content } = redactContent(m, original, req.marks, overlay);
  let bytes = afterContent;
  const sanitize = { ...EMPTY_SANITIZE_REPORT };
  if (req.sanitize?.hiddenText) {
    const hidden = removeHiddenText(m, bytes);
    bytes = hidden.bytes;
    sanitize.hiddenTextRemoved = hidden.removed;
  }
  const secrets = secretsFor(req.found, content.removedText);
  const objs = await PdfObjects.read(qpdf, bytes);
  const objects = removeUnderMarks(objs, req.marks);
  scrubAfterRedaction(objs, secrets);
  if (req.sanitize)
    Object.assign(sanitize, sanitizeObjects(objs, req.sanitize), {
      hiddenTextRemoved: sanitize.hiddenTextRemoved,
    });
  const out = await rewrite(qpdf, bytes, objs);
  const hits = await leakScan(m, qpdf, out, secrets, req.marks, overlay);
  if (hits.length) throw new RedactionLeakError(hits);
  return { bytes: out, content, objects, sanitize, secrets };
}

/** Sanitize Document on its own: a full rewrite, never an incremental save. */
export async function sanitizeDocument(
  m: PdfiumModule,
  qpdf: Qpdf,
  original: Uint8Array,
  opt: SanitizeOptions,
): Promise<{ bytes: Uint8Array; report: SanitizeReport }> {
  let bytes = original;
  let hiddenTextRemoved = 0;
  if (opt.hiddenText) ({ bytes, removed: hiddenTextRemoved } = removeHiddenText(m, bytes));
  const objs = await PdfObjects.read(qpdf, bytes);
  const report = { ...sanitizeObjects(objs, opt), hiddenTextRemoved };
  return { bytes: await rewrite(qpdf, bytes, objs), report };
}

/** "Return 2024.pdf" -> "Return 2024_Redacted.pdf" (any folder part is kept). */
export function redactedFileName(path: string): string {
  const m = /^(.*?)(\.pdf)?$/i.exec(path);
  return `${m?.[1] ?? path}_Redacted.pdf`;
}
