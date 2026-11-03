// Apply redactions and Sanitize Document (Phase 5). Both always write a NEW, fully
// rewritten file next to the original ("<name>_Redacted.pdf", "<name>_Sanitized.pdf";
// " (2)" etc. when taken) and open it; the original is never changed. Heavy work runs in
// the page-engine worker. Redacted text never goes to a toast or the log.
import type { WorkbenchApi } from "../../app/workbench";
import { plural } from "../kit/text";
import { pageOp } from "../../app/pages";
import type { LeakHit, OverlayOptions, SanitizeOptions } from "../../engine/redact";
import { dirName, platform, safeFileName } from "../../platform";
import { toRequestMarks, type Mark } from "./marks";
import { redactMarks } from "./redactStore";

const stem = (name: string) => name.replace(/\.pdf$/i, "");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function writeNew(
  wb: WorkbenchApi,
  documentId: string,
  suffix: string,
  bytes: Uint8Array,
): Promise<string | null> {
  const m = wb.meta[documentId];
  if (!m) return null;
  const name = safeFileName(`${stem(m.name)}_${suffix}.pdf`);
  if (m.source.kind === "path") return platform.writeNewFile(dirName(m.source.path), name, bytes);
  const target = await platform.pickSavePath(name);
  if (!target) return null;
  await platform.saveAs(target, null, bytes);
  return target;
}

/** Where a leak was found, in words (no redacted text). */
export function describeHits(hits: LeakHit[]): string {
  const parts = new Set<string>();
  for (const h of hits) {
    if (h.where === "page-text") parts.add(`text on page ${(h.pageIndex ?? 0) + 1}`);
    else if (h.where === "box-render")
      parts.add(`something still shows inside a box on page ${(h.pageIndex ?? 0) + 1}`);
    else parts.add("the file's hidden data (properties, bookmarks, comments or form data)");
  }
  return [...parts].join("; ");
}

export async function applyRedactions(
  wb: WorkbenchApi,
  documentId: string,
  accepted: Mark[],
  pageHeights: number[],
  overlay: OverlayOptions,
  sanitize: SanitizeOptions | null,
): Promise<boolean> {
  if (!accepted.length) {
    wb.toast("Accept at least one mark first.");
    return false;
  }
  const bytes = await wb.docBytes(documentId);
  if (!bytes) {
    wb.toast("This document cannot be redacted (it is password-protected).", "error");
    return false;
  }
  const found = accepted
    .map((m) => redactMarks.info(documentId, m.id)?.text)
    .filter((t): t is string => !!t);
  try {
    const r = await pageOp("redactApply", bytes, {
      marks: toRequestMarks(accepted, pageHeights),
      found,
      overlay,
      sanitize,
    });
    if (!r.ok) {
      wb.toast(
        `Not saved: the redaction check still found redacted content in ${describeHits(r.hits)}. ` +
          "Mark it too (Search & Redact finds repeats), or run Sanitize, then Apply again.",
        "error",
      );
      return false;
    }
    const path = await writeNew(wb, documentId, "Redacted", r.bytes);
    if (!path) return false;
    const extra = [
      r.imagesRemoved ? `${plural(r.imagesRemoved, "image")} removed` : "",
      r.annotationsRemoved
        ? `${plural(r.annotationsRemoved, "comment or link", "comments or links")} removed`
        : "",
      r.fieldsRemoved ? `${plural(r.fieldsRemoved, "form field")} removed` : "",
      r.pathsRemovedWhole ? `${plural(r.pathsRemovedWhole, "drawing")} removed whole` : "",
    ].filter(Boolean);
    wb.toast(
      `Redacted ${plural(accepted.length, "mark")} into a new file${extra.length ? ` (${extra.join(", ")})` : ""}. ` +
        "The original is unchanged.",
    );
    await wb.openPaths([path]);
    return true;
  } catch (e) {
    wb.toast(`Redaction failed: ${message(e)}`, "error");
    return false;
  }
}

export async function sanitizeToNewFile(
  wb: WorkbenchApi,
  documentId: string,
  opt: SanitizeOptions,
): Promise<void> {
  const bytes = await wb.docBytes(documentId);
  if (!bytes) {
    wb.toast("This document cannot be sanitized (it is password-protected).", "error");
    return;
  }
  try {
    const r = await pageOp("sanitize", bytes, opt);
    const path = await writeNew(wb, documentId, "Sanitized", r.bytes);
    if (!path) return;
    const n = r.report;
    wb.toast(
      `Sanitized into a new file: ${n.metadataRemoved} metadata, ${n.attachmentsRemoved} attachment, ` +
        `${n.actionsRemoved} script/action, ${n.privateDataRemoved} private-data and ` +
        `${plural(n.hiddenTextRemoved, "hidden-text item")} removed. The original is unchanged.`,
    );
    await wb.openPaths([path]);
  } catch (e) {
    wb.toast(`Sanitize failed: ${message(e)}`, "error");
  }
}
