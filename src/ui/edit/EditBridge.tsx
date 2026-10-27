// Edit PDF (B3): keeps the page interaction mode in step with the Edit tool. Opening
// the tool turns Edit mode on (like Acrobat); closing it, or picking a markup tool,
// turns it off and clears the selection.
import { useEffect, useRef } from "react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { useWorkbench } from "../../app/workbench";
import { EDIT_MODE, editSession, resetEdit } from "./editStore";

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

  // Leaving Edit mode commits an open editor, then clears everything. Only a real
  // on -> off change: a tab reloaded by an edit mounts with the mode still off.
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current === editing) return;
    wasEditing.current = editing;
    if (editing) return;
    editSession.commit(documentId);
    resetEdit(documentId);
  }, [documentId, editing]);

  return null;
}
