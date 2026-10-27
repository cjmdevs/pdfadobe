// Builds the ToolContext for the active document (or for no document).
import { useMemo } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { ZoomMode } from "@embedpdf/plugin-zoom";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { ERASER_MODE, STAMP_MODE } from "../markup/config";
import { EDIT_MODE } from "../ui/edit/editStore";
import { TEXT_STAMPS } from "../engine/stamps";
import { stampPlacement, textStamp } from "../ui/markup/stampPlacement";
import { importXfdf } from "../ui/markup/importXfdf";
import { usePageActions } from "../app/pageActions";
import { useNav } from "../app/useNav";
import { useWorkbench } from "../app/workbench";
import { ACTUAL_SIZE_SCALE } from "../app/zoom";
import type { ToolContext } from "./registry";

/** For a loaded document. Call only inside a component keyed/guarded by that document. */
export function useDocToolContext(documentId: string): ToolContext {
  const wb = useWorkbench();
  const nav = useNav(documentId);
  const actions = usePageActions(documentId);
  const { provides: zoom, state: zoomState } = useZoom(documentId);
  const { provides: annots, state: annotState } = useAnnotation(documentId);
  const activeMarkup = annotState.activeToolId;
  const { provides: im, state: imState } = useInteractionManager(documentId);
  const erasing = imState.activeMode === ERASER_MODE;
  const level = zoomState.zoomLevel;
  const mode =
    level === ZoomMode.FitPage ? "fit-page" : level === ZoomMode.FitWidth ? "fit-width" : "other";
  const docState = useDocumentState(documentId);
  const encrypted = docState?.document?.isEncrypted ?? false;
  const m = wb.meta[documentId];
  const organizing = m?.activeTool === "organize";
  const stored = m?.pageSelection;
  return useMemo(
    () => ({
      wb,
      documentId,
      pages: organizing ? (stored ?? []) : [nav.page],
      pageCount: nav.pageCount,
      actions: encrypted || wb.busy !== null ? null : actions,
      view: zoom
        ? {
            mode,
            fitPage: () => zoom.requestZoom(ZoomMode.FitPage),
            fitWidth: () => zoom.requestZoom(ZoomMode.FitWidth),
            actualSize: () => zoom.requestZoom(ACTUAL_SIZE_SCALE),
          }
        : null,
      // Markup needs the store's bytes on save, which encrypted documents do not have.
      markup:
        annots && !encrypted
          ? {
              activeTool: activeMarkup,
              setTool: (id) => annots.setActiveTool(id),
              erasing,
              setErasing: (on) => {
                if (!on) return im?.activateDefaultMode();
                annots.setActiveTool(null);
                annots.deselectAnnotation();
                im?.activate(ERASER_MODE);
              },
              selectedIds: annotState.selectedUids
                .map((u) => annotState.byUid[u]?.object.id)
                .filter((x): x is string => x !== undefined),
              importXfdf: () => importXfdf(wb, documentId, annots, annotState, docState),
              pickStamp: (id) => {
                const def = TEXT_STAMPS.find((d) => d.id === id);
                if (!def) return;
                void textStamp(def, wb.author).then((s) => {
                  annots.setActiveTool(null);
                  stampPlacement.set(s);
                  im?.activate(STAMP_MODE);
                  wb.toast(`Click on the page to place the ${s.subject} stamp (Esc cancels).`);
                });
              },
            }
          : null,
      // Edit PDF reads and writes the store's bytes, which encrypted documents lack.
      edit: encrypted
        ? null
        : {
            on: imState.activeMode === EDIT_MODE,
            setOn: (on) => (on ? im?.activate(EDIT_MODE) : im?.activateDefaultMode()),
          },
    }),
    [
      wb,
      documentId,
      organizing,
      stored,
      nav.page,
      nav.pageCount,
      actions,
      encrypted,
      zoom,
      mode,
      annots,
      annotState,
      docState,
      activeMarkup,
      im,
      erasing,
      imState.activeMode,
    ],
  );
}

export function useNoDocToolContext(): ToolContext {
  const wb = useWorkbench();
  return useMemo(
    () => ({
      wb,
      documentId: null,
      pages: [],
      pageCount: 0,
      actions: null,
      view: null,
      markup: null,
      edit: null,
    }),
    [wb],
  );
}
