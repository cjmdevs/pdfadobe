// Builds the ToolContext for the active document (or for no document).
import { useMemo } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { ZoomMode } from "@embedpdf/plugin-zoom";
import { useZoom } from "@embedpdf/plugin-zoom/react";
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
  const level = zoomState.zoomLevel;
  const mode =
    level === ZoomMode.FitPage ? "fit-page" : level === ZoomMode.FitWidth ? "fit-width" : "other";
  const encrypted = useDocumentState(documentId)?.document?.isEncrypted ?? false;
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
    }),
    [wb, documentId, organizing, stored, nav.page, nav.pageCount, actions, encrypted, zoom, mode],
  );
}

export function useNoDocToolContext(): ToolContext {
  const wb = useWorkbench();
  return useMemo(
    () => ({ wb, documentId: null, pages: [], pageCount: 0, actions: null, view: null }),
    [wb],
  );
}
