// Edit PDF (B3): keeps the page interaction mode in step with the Edit tool. Opening
// the tool turns Edit mode on (like Acrobat); closing it, or picking a markup tool,
// turns it off and clears the selection.
import { useEffect, useRef } from "react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { useWorkbench } from "../../app/workbench";
import { EDIT_MODE, editSelection } from "./editStore";

export function EditBridge({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const { provides: im, state } = useInteractionManager(documentId);
  const toolOpen = wb.meta[documentId]?.activeTool === "edit";
  const editing = state.activeMode === EDIT_MODE;

  // Only when the tool opens or closes: the Edit button may turn the mode off meanwhile.
  const wasOpen = useRef<boolean | null>(null);
  useEffect(() => {
    if (!im || wasOpen.current === toolOpen) return;
    wasOpen.current = toolOpen;
    if (toolOpen) im.activate(EDIT_MODE);
    else if (im.getActiveMode() === EDIT_MODE) im.activateDefaultMode();
  }, [im, toolOpen]);

  useEffect(() => {
    if (!editing) editSelection.set(documentId, null);
  }, [documentId, editing]);

  return null;
}
