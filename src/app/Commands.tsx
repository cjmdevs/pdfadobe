// Runs keyboard shortcuts (src/app/shortcuts.ts) and toolbar commands against the
// active document. Rendered once; holds no UI.
import { REDACT_MODE } from "../ui/redact/redactStore";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import {
  useActiveDocument,
  useDocumentManagerCapability,
} from "@embedpdf/plugin-document-manager/react";
import { useRotate } from "@embedpdf/plugin-rotate/react";
import { useSearch } from "@embedpdf/plugin-search/react";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { useViewportCapability } from "@embedpdf/plugin-viewport/react";
import { ZoomMode } from "@embedpdf/plugin-zoom";
import { PdfPermissionFlag, type PdfAnnotationObject } from "@embedpdf/models";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { ERASER_MODE, STAMP_MODE } from "../markup/config";
import { EDIT_MODE, addText, editSelection, editSession, pendingImage } from "../ui/edit/editStore";
import { deleteSelection } from "../ui/edit/editActions";
import { stampPlacement } from "../ui/markup/stampPlacement";
import { FLYER_MODE, flyerPlacement } from "../ui/flyer/flyerStore";
import { Guard } from "../ui/Guard";
import { matchShortcut, type Command } from "./shortcuts";
import { useNav } from "./useNav";
import { platform } from "../platform";
import { useWorkbench } from "./workbench";
import { ACTUAL_SIZE_SCALE } from "./zoom";

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.isContentEditable ||
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT"
  );
}

function focusAndSelect(id: string) {
  const el = document.getElementById(id);
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.select();
  }
}

/** Document-scoped command runner, registered while a loaded document is active. */
type DocRunner = (cmd: Command) => boolean;

/** The active document's id once it has loaded (plugin state exists only then). */
export function useLoadedDocumentId(): string | null {
  const { activeDocumentId, activeDocument } = useActiveDocument();
  return activeDocument?.status === "loaded" ? activeDocumentId : null;
}

export function Commands() {
  const wb = useWorkbench();
  const { activeDocumentId } = useActiveDocument();
  const loadedId = useLoadedDocumentId();
  const { provides: manager } = useDocumentManagerCapability();
  const docRunner = useRef<DocRunner | null>(null);
  const register = useCallback((fn: DocRunner | null) => {
    docRunner.current = fn;
  }, []);

  const run = (cmd: Command): boolean => {
    // Commands that work without a document.
    switch (cmd) {
      case "open":
        void wb.pickAndOpen();
        return true;
      case "help":
        wb.setDialog({ kind: "shortcuts" });
        return true;
      case "escape":
        if (wb.dialog) wb.setDialog(null);
        else if (wb.searchOpen) wb.setSearchOpen(false);
        // Otherwise the document's own Escape (markup tool off, deselect).
        else return docRunner.current?.(cmd) ?? false;
        return true;
      case "toggleNavPane":
        wb.updateSettings({ sidebarOpen: !wb.settings.sidebarOpen });
        return true;
      case "focusNavPane":
        wb.updateSettings({ sidebarOpen: true });
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>("#nav-pane [role=tab][aria-selected=true]")?.focus(),
        );
        return true;
      case "closeAll":
        wb.closeAll();
        return true;
      case "quit":
        // Browser build: one window, nothing to exit.
        if (!platform.windows) return false;
        void wb.quit();
        return true;
      case "nextTab":
      case "prevTab": {
        const order = manager?.getDocumentOrder() ?? [];
        if (order.length < 2 || !activeDocumentId) return true;
        const i = order.indexOf(activeDocumentId);
        const next = order[(i + (cmd === "nextTab" ? 1 : -1) + order.length) % order.length];
        if (next) manager?.setActiveDocument(next);
        return true;
      }
      case "close":
        if (!activeDocumentId) return false;
        wb.closeDocument(activeDocumentId);
        return true;
      case "undo":
      case "redo":
      case "save":
      case "saveAs":
        if (!activeDocumentId) return false;
        // Save waits for running page operations itself. Undo/redo while one runs would
        // be ambiguous: ignored (the running operation becomes the next undo step).
        if (cmd === "save") void wb.save(activeDocumentId);
        else if (cmd === "saveAs") void wb.saveAs(activeDocumentId);
        else if (wb.busy) return true;
        else if (cmd === "undo") wb.undo(activeDocumentId);
        else wb.redo(activeDocumentId);
        return true;
    }
    return docRunner.current?.(cmd) ?? false;
  };

  // Always call the latest closure from the stable listeners below.
  const runRef = useRef(run);
  useLayoutEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      // Inside a modal dialog only Escape is ours (the dialog handles it via onCancel).
      if (document.querySelector("dialog[open]")) return;
      const cmd = matchShortcut(e, isEditable(e.target));
      if (cmd && runRef.current(cmd)) e.preventDefault();
    };
    const onCommand = (e: Event) => runRef.current((e as CustomEvent<Command>).detail);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pdfwb:command", onCommand);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pdfwb:command", onCommand);
    };
  }, []);

  return loadedId ? (
    <Guard resetKey={loadedId}>
      <DocCommands key={loadedId} documentId={loadedId} register={register} />
    </Guard>
  ) : null;
}

function DocCommands({
  documentId,
  register,
}: {
  documentId: string;
  register: (run: DocRunner | null) => void;
}) {
  const wb = useWorkbench();
  const nav = useNav(documentId);
  const { provides: zoom } = useZoom(documentId);
  const { provides: rotate } = useRotate(documentId);
  const { provides: search } = useSearch(documentId);
  const { provides: selection } = useSelectionCapability();
  const { provides: viewport } = useViewportCapability();
  const { provides: annots, state: annotState } = useAnnotation(documentId);
  const { provides: im, state: imState } = useInteractionManager(documentId);
  const eraserOn =
    imState.activeMode === ERASER_MODE ||
    imState.activeMode === STAMP_MODE ||
    imState.activeMode === FLYER_MODE ||
    imState.activeMode === REDACT_MODE;
  const doc = useDocumentState(documentId)?.document ?? null;
  /** Resolves when the last Ctrl+A selection is in place. */
  const pendingSelect = useRef<Promise<unknown>>(Promise.resolve());

  const run = (cmd: Command): boolean => {
    if (!doc) return false;
    const vp = viewport?.forDocument(documentId);
    const screen = () => (vp?.getMetrics().clientHeight ?? 600) * 0.9;
    switch (cmd) {
      case "escape": {
        // Typing in a text box or note: leave it, keeping the text (like Acrobat).
        const el = document.activeElement;
        if (el instanceof HTMLElement && el.isContentEditable) {
          el.blur();
          return true;
        }
        // Edit PDF: the selection goes first, then the tool closes.
        if (imState.activeMode === EDIT_MODE) {
          if (editSession.commit(documentId)) return true;
          if (pendingImage.get(documentId)) pendingImage.set(documentId, null);
          else if (addText.get(documentId)) addText.set(documentId, false);
          else if (editSelection.get(documentId)) editSelection.set(documentId, null);
          else wb.setActiveTool(documentId, null);
          return true;
        }
        // Markup: a tool (or the eraser) that is on goes off first, then the selection.
        if (eraserOn) {
          stampPlacement.set(null);
          flyerPlacement.set(null);
          im?.activateDefaultMode();
        } else if (annotState.activeToolId) annots?.setActiveTool(null);
        else if (annotState.selectedUids.length) annots?.deselectAnnotation();
        else return false;
        return true;
      }
      case "deleteAnnotation": {
        // Edit PDF: Delete removes the selected image or text box (one undo step).
        if (imState.activeMode === EDIT_MODE) {
          const sel = editSelection.get(documentId);
          if (!sel || wb.busy) return false;
          void deleteSelection(wb, documentId, sel).then(
            (ok) => ok && editSelection.set(documentId, null),
          );
          return true;
        }
        const picked = annotState.selectedUids
          .map((uid) => annotState.byUid[uid]?.object)
          .filter((a): a is PdfAnnotationObject => a !== undefined && !a.flags?.includes("locked"));
        if (!picked.length || wb.busy) return false;
        annots?.deleteAnnotations(picked.map((a) => ({ pageIndex: a.pageIndex, id: a.id })));
        return true;
      }
      case "nextPage":
        nav.next();
        break;
      case "prevPage":
        nav.prev();
        break;
      case "nextScreen":
      case "prevScreen": {
        const m = vp?.getMetrics();
        const atEdge =
          !m ||
          (cmd === "nextScreen"
            ? m.scrollTop + m.clientHeight >= m.scrollHeight - 2
            : m.scrollTop <= 0);
        // Single Page mode: past the end of the page, turn the page.
        if (wb.settings.viewMode === "single" && atEdge) {
          if (cmd === "nextScreen") nav.next();
          else nav.prev();
        } else if (m) {
          vp?.scrollTo({
            x: m.scrollLeft,
            y: m.scrollTop + (cmd === "nextScreen" ? screen() : -screen()),
          });
        }
        break;
      }
      case "firstPage":
        nav.first();
        break;
      case "lastPage":
        nav.last();
        break;
      case "goToPage":
        focusAndSelect("page-input");
        break;
      case "zoomIn":
        zoom?.zoomIn();
        break;
      case "zoomOut":
        zoom?.zoomOut();
        break;
      case "fitPage":
        zoom?.requestZoom(ZoomMode.FitPage);
        break;
      case "fitWidth":
        zoom?.requestZoom(ZoomMode.FitWidth);
        break;
      case "actualSize":
        zoom?.requestZoom(ACTUAL_SIZE_SCALE);
        break;
      case "rotateCw":
        rotate?.rotateForward();
        break;
      case "rotateCcw":
        rotate?.rotateBackward();
        break;
      case "find":
        if (wb.searchOpen) document.dispatchEvent(new Event("pdfwb:focus-search"));
        else wb.setSearchOpen(true);
        break;
      case "findNext":
        if (!wb.searchOpen) wb.setSearchOpen(true);
        else search?.nextResult();
        break;
      case "findPrev":
        if (!wb.searchOpen) wb.setSearchOpen(true);
        else search?.previousResult();
        break;
      case "print":
        void wb.print(documentId, nav.page);
        break;
      case "properties":
        wb.setDialog({ kind: "properties", documentId });
        break;
      case "copy":
        if (doc.isEncrypted && (doc.permissions & PdfPermissionFlag.CopyContents) === 0)
          wb.toast("This document's security settings do not allow copying.", "error");
        // Wait for a pending Ctrl+A (it loads text geometry for every page first).
        else void pendingSelect.current.then(() => selection?.copyToClipboard(documentId));
        break;
      case "selectAll":
        selectAll(documentId);
        break;
      default:
        return false;
    }
    return true;
  };

  const selectAll = (docId: string) => {
    if (!doc || !selection) return;
    // The plugin clamps indexes to each page's text, so "to the end" is simply a huge index.
    pendingSelect.current = selection
      .setSelection(
        {
          start: { page: 0, index: 0 },
          end: { page: doc.pageCount - 1, index: Number.MAX_SAFE_INTEGER },
        },
        docId,
      )
      .toPromise()
      .catch(() => undefined);
  };

  useLayoutEffect(() => register(run));
  useEffect(() => () => register(null), [register]);
  return null;
}
