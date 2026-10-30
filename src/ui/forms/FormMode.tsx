// Fill or design (Phase 6): form widgets are locked (filled) except while Prepare Form is
// open for this tab, when they can be selected, moved and resized. Also switches the
// page pointer to field placement while a field kind is armed.
import { useEffect, useRef } from "react";
import { LockModeType } from "@embedpdf/plugin-annotation";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { useWorkbench } from "../../app/workbench";
import { FIELD_MODE, PREPARE_TOOL, prepare, usePrepare } from "./prepareStore";

export function FormMode({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const designing = wb.meta[documentId]?.activeTool === PREPARE_TOOL;
  const { provides: scope } = useAnnotation(documentId);
  const { provides: im, state: imState } = useInteractionManager(documentId);
  const { pending } = usePrepare(documentId);

  useEffect(() => {
    // Links stay locked either way: a click follows them (LinkNavigator), and the Edit
    // tool's Link button is where they are changed.
    scope?.setLocked({
      type: LockModeType.Include,
      categories: designing ? ["link"] : ["form", "link"],
    });
    if (!designing) prepare.arm(documentId, null);
  }, [designing, scope, documentId]);

  useEffect(() => {
    if (pending && designing) im?.activate(FIELD_MODE);
  }, [pending, designing, im]);

  // Esc while a field waits to be placed: cancel it here, first, the same way the
  // panel button does. Left to the shared Esc handling, field selection stopped
  // working afterwards until the tool was reopened.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      prepare.arm(documentId, null);
      im?.activateDefaultMode();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pending, im, documentId]);

  // Esc (or another mode) ends placement: forget the armed kind. Only after placement
  // mode was on, so the arming itself (mode not switched yet) does not cancel it.
  const wasPlacing = useRef(false);
  useEffect(() => {
    const placing = imState.activeMode === FIELD_MODE;
    if (wasPlacing.current && !placing && prepare.pending(documentId))
      prepare.arm(documentId, null);
    wasPlacing.current = placing;
  }, [imState.activeMode, documentId]);
  return null;
}
