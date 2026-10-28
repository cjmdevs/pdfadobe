// Redact commands for the active document (Phase 5), for the tool context.
import { useMemo, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { useWorkbench } from "../../app/workbench";
import { pageOp } from "../../app/pages";
import type { SanitizeOptions } from "../../engine/redact";
import type { RedactCommands } from "../../tools/registry";
import { addCandidates, addMark, marksOf, pad } from "./marks";
import { REDACT_MODE, redactMarks, useRedactVersion } from "./redactStore";
import { applyRedactions, sanitizeToNewFile } from "./redactFiles";

export function useRedactCommands(documentId: string, enabled: boolean): RedactCommands | null {
  const wb = useWorkbench();
  const { provides: annots, state } = useAnnotation(documentId);
  const { provides: im, state: imState } = useInteractionManager(documentId);
  const { provides: selection } = useSelectionCapability();
  const doc = useDocumentState(documentId)?.document ?? null;
  const version = useRedactVersion();
  const [working, setWorking] = useState(false);
  const marks = useMemo(
    () => marksOf(Object.values(state.byUid).map((t) => t.object)),
    [state.byUid],
  );
  return useMemo(() => {
    if (!enabled || !annots || !doc) return null;
    const heights = doc.pages.map((p) => p.size.height);
    const accepted = marks.filter((m) => redactMarks.accepted(documentId, m.id));
    const run = async (fn: () => Promise<unknown>) => {
      setWorking(true);
      try {
        await fn();
      } finally {
        setWorking(false);
      }
    };
    return {
      drawing: imState.activeMode === REDACT_MODE,
      setDrawing: (on) => {
        if (!on) return im?.activateDefaultMode();
        annots.setActiveTool(null);
        annots.deselectAnnotation();
        im?.activate(REDACT_MODE);
        wb.toast("Drag a box over what to remove (Esc stops).");
      },
      markSelection: () => {
        const byPage = selection?.getHighlightRects(documentId) ?? {};
        const pages = Object.entries(byPage).filter(([, rects]) => rects.length);
        if (!pages.length) {
          wb.toast("Select text on the page first, then mark it.");
          return;
        }
        void selection
          ?.getSelectedText(documentId)
          .toPromise()
          .then(
            (texts) => texts,
            () => [] as string[],
          )
          .then((texts) => {
            const text = texts.join(" ").trim();
            for (const [page, rects] of pages) {
              addMark(
                annots,
                documentId,
                Number(page),
                rects.map((r) => pad(r)),
                text ? { source: "selection", text } : { source: "selection" },
                wb.author,
              );
            }
            selection?.clear();
          });
      },
      markPages: (pages) => {
        void wb.contentBytes(documentId).then(async (bytes) => {
          if (!bytes) return;
          const list = await pageOp("redactPageMarks", bytes, pages);
          addCandidates(annots, documentId, heights, list, wb.author);
          wb.toast(`Marked ${list.length} whole page(s) for redaction.`);
        });
      },
      marks: marks.length,
      accepted: accepted.length,
      working,
      apply: (sanitize?: SanitizeOptions | null) =>
        run(async () => {
          const ok = await applyRedactions(
            wb,
            documentId,
            accepted,
            heights,
            redactMarks.overlay(),
            sanitize ?? null,
          );
          if (ok) im?.activateDefaultMode();
        }),
      sanitize: (opt) => run(() => sanitizeToNewFile(wb, documentId, opt)),
    };
    // `version` re-reads the accepted marks when the review state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    annots,
    doc,
    marks,
    imState.activeMode,
    im,
    selection,
    wb,
    documentId,
    working,
    version,
  ]);
}
