// Builds the ToolContext for the active document (or for no document).
import { useEffect, useMemo } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { ZoomMode } from "@embedpdf/plugin-zoom";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { ERASER_MODE, SIGN_BOX_MODE, STAMP_MODE } from "../markup/config";
import {
  linkMode,
  useLinkMode,
  EDIT_MODE,
  addText,
  pendingImage,
  useAddingText,
  usePendingImage,
} from "../ui/edit/editStore";
import { pickImageToAdd, removeAllWebLinks } from "../ui/edit/editActions";
import { platform } from "../platform";
import {
  clipboardImage,
  imageStamp,
  stampPlacement,
  textStamp,
  type PendingStamp,
} from "../ui/markup/stampPlacement";
import { allStamps, stampMenu, useStampLibraryVersion } from "../ui/markup/stampLibrary";
import { placeRequest, usePlaceRequest } from "../ui/sign/placeRequest";
import { signatureStamp, useSavedSignatures } from "../ui/sign/fillSign";
import { importXfdf } from "../ui/markup/importXfdf";
import { useFlyerCommands } from "../ui/flyer/useFlyer";
import { useRedactCommands } from "../ui/redact/useRedact";
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
  const adding = useAddingText(documentId);
  const placingImage = usePendingImage(documentId) !== null;
  const linking = useLinkMode(documentId) !== null;
  const encrypted = docState?.document?.isEncrypted ?? false;
  const m = wb.meta[documentId];
  const organizing = m?.activeTool === "organize";
  const stored = m?.pageSelection;
  // Tickmarks are markup: same rule (encrypted documents have no bytes to save).
  const flyer = useFlyerCommands(documentId, !encrypted);
  // Redaction reads the store's bytes too.
  const redact = useRedactCommands(documentId, !encrypted);
  // Custom stamps load here; the Stamp menu reads them when it opens.
  useStampLibraryVersion();
  // A signature just saved in Add Signature is placed on this document.
  const place = usePlaceRequest();
  const saved = useSavedSignatures();
  useEffect(() => {
    if (!place || place.documentId !== documentId || !annots || encrypted) return;
    // Several components build this context; the first to see the request takes it.
    if (placeRequest.get() !== place) return;
    placeRequest.set(null);
    void signatureStamp(place.signature, wb.settings.signWithDate).then(
      (s) => {
        annots.setActiveTool(null);
        stampPlacement.set(s);
        im?.activate(STAMP_MODE);
        wb.toast(`Click on the page to place your ${s.subject.toLowerCase()} (Esc cancels).`);
      },
      (e: unknown) =>
        wb.toast(`Could not place it: ${e instanceof Error ? e.message : String(e)}`, "error"),
    );
  }, [place, documentId, annots, encrypted, im, wb]);
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
              pickStamp: (ref) => {
                const arm = (s: PendingStamp) => {
                  annots.setActiveTool(null);
                  stampPlacement.set(s);
                  im?.activate(STAMP_MODE);
                  wb.updateSettings({ lastStamp: ref.includes(":") ? ref : `b:${ref}` });
                  wb.toast(`Click on the page to place the ${s.subject} stamp (Esc cancels).`);
                };
                const fail = (e: unknown) =>
                  wb.toast(`Stamp failed: ${e instanceof Error ? e.message : String(e)}`, "error");
                const entry = allStamps(wb).find((e) => e.ref === ref || e.ref === `b:${ref}`);
                if (entry?.builtIn) void textStamp(entry.builtIn, wb.author).then(arm, fail);
                else if (entry?.custom) {
                  const c = entry.custom;
                  void platform.stamps
                    .read(c.id)
                    .then((b) => imageStamp(entry.name, b, c.mime))
                    .then(arm, fail);
                }
              },
              pasteStamp: () => {
                void clipboardImage().then(
                  (img) => {
                    if (!img) {
                      wb.toast("There is no picture on the clipboard.", "error");
                      return;
                    }
                    void imageStamp("Pasted image", img.bytes, img.mime).then((s) => {
                      annots.setActiveTool(null);
                      stampPlacement.set(s);
                      im?.activate(STAMP_MODE);
                      wb.toast("Click on the page to place the pasted picture (Esc cancels).");
                    });
                  },
                  () => wb.toast("The clipboard could not be read.", "error"),
                );
              },
              stampMenu: () => stampMenu(wb, allStamps(wb)),
              savedSignatures: saved,
              armStamp: (s) => {
                annots.setActiveTool(null);
                stampPlacement.set(s);
                im?.activate(STAMP_MODE);
                wb.toast(
                  `Click on the page to place the ${s.subject.toLowerCase()} (Esc cancels).`,
                );
              },
            }
          : null,
      // Edit PDF reads and writes the store's bytes, which encrypted documents lack.
      edit: encrypted
        ? null
        : {
            on: imState.activeMode === EDIT_MODE,
            setOn: (on) => (on ? im?.activate(EDIT_MODE) : im?.activateDefaultMode()),
            adding,
            setAdding: (on) => {
              if (on) {
                im?.activate(EDIT_MODE);
                pendingImage.set(documentId, null);
              }
              addText.set(documentId, on);
            },
            placingImage,
            addImage: () => {
              im?.activate(EDIT_MODE);
              addText.set(documentId, false);
              linkMode.set(documentId, false);
              void pickImageToAdd(wb, documentId);
            },
            linking,
            setLinking: (on) => {
              if (on) im?.activate(EDIT_MODE);
              linkMode.set(documentId, on);
            },
            removeWebLinks: () => void removeAllWebLinks(wb, documentId),
          },
      flyer,
      redact,
      sign: {
        drawing: imState.activeMode === SIGN_BOX_MODE,
        setDrawing: (on) => {
          if (!on) return im?.activateDefaultMode();
          annots?.setActiveTool(null);
          im?.activate(SIGN_BOX_MODE);
          wb.toast(
            "Drag a box where the signature goes (or click for the usual size). Esc cancels.",
          );
        },
        encrypted,
      },
    }),
    [
      saved,
      flyer,
      redact,
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
      adding,
      placingImage,
      linking,
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
      flyer: null,
      redact: null,
      sign: null,
    }),
    [wb],
  );
}
