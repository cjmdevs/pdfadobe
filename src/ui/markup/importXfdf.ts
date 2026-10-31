// XFDF import (Phase 3): adds the file's comments to the open document through the
// annotation plugin, so it is one more undoable markup change. Comments already in the
// document (same /NM id) are skipped. Our built-in stamps are drawn again by subject.
import type { DocumentState } from "@embedpdf/core";
import type {
  AnnotationDocumentState,
  AnnotationScope,
  AnnotationTransferItem,
} from "@embedpdf/plugin-annotation";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import type { WorkbenchApi } from "../../app/workbench";
import { TEXT_STAMPS, drawTextStamp, dynamicText, stampTitle } from "../../engine/stamps";
import { XfdfError, parseXfdf } from "../../engine/xfdf";
import { pickXfdf } from "./markupFiles";

export async function importXfdf(
  wb: WorkbenchApi,
  _documentId: string,
  scope: AnnotationScope,
  state: AnnotationDocumentState,
  doc: DocumentState | null,
): Promise<void> {
  const pages = doc?.document?.pages;
  if (!pages) return;
  const xml = await pickXfdf();
  if (xml === null) return;
  let parsed;
  try {
    parsed = parseXfdf(
      xml,
      pages.map((p) => p.size.height),
    );
  } catch (e) {
    wb.toast(
      e instanceof XfdfError ? `Cannot import: ${e.message}.` : `Import failed: ${String(e)}`,
      "error",
    );
    return;
  }
  const have = new Set(Object.values(state.byUid).map((t) => t.object.id));
  const fresh = parsed.annotations.filter((a) => !have.has(a.id));
  const items: AnnotationTransferItem[] = [];
  for (const a of fresh) {
    if (a.type === PdfAnnotationSubtype.STAMP) {
      const def = TEXT_STAMPS.find((d) => stampTitle(d).toLowerCase() === a.subject?.toLowerCase());
      if (def) {
        const art = await drawTextStamp(
          def,
          a.author ? dynamicText(def, a.author, a.created ?? a.modified ?? new Date()) : undefined,
        );
        items.push({
          annotation: a,
          ctx: { data: art.pdf.slice().buffer, mimeType: "application/pdf" },
        });
        continue;
      }
    }
    items.push({ annotation: a });
  }
  // One by one through createAnnotation (importAnnotations skips the undo history).
  for (const it of items)
    scope.createAnnotation(it.annotation.pageIndex, it.annotation, it.ctx as never);
  const dup = parsed.annotations.length - fresh.length;
  wb.toast(
    `Imported ${items.length} comment(s)` +
      (dup ? `; ${dup} already in this document` : "") +
      (parsed.skipped ? `; ${parsed.skipped} on pages this document does not have` : "") +
      ".",
  );
}
