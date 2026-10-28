// Edit PDF (B3): keeps the page interaction mode in step with the Edit tool. Opening
// the tool turns Edit mode on (like Acrobat); closing it, or picking a markup tool,
// turns it off and clears the selection.
import { useEffect, useRef } from "react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { useWorkbench } from "../../app/workbench";
import {
  EDIT_MODE,
  editSelection,
  editSession,
  nudge,
  pageInfos,
  pendingImage,
  resetEdit,
} from "./editStore";
import { moveTextBox, placeImageEdit } from "./editActions";

/** Arrow keys move the selection 1 point (Shift: 10); written this long after the last key. */
const NUDGE_WAIT = 450;

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
    pendingImage.set(documentId, null);
  }, [documentId, editing]);

  // The latest workbench for the key listener (it is re-created on every change).
  const wbRef = useRef(wb);
  useEffect(() => {
    wbRef.current = wb;
  });

  // Arrow keys nudge the selected text box or image (not while typing). The steps add
  // up on screen and are written as one "Move" once the keys stop.
  useEffect(() => {
    if (!editing) return;
    let timer = 0;
    const flush = () => {
      timer = 0;
      const d = nudge.get(documentId);
      const sel = editSelection.get(documentId);
      nudge.set(documentId, null);
      const info = sel && pageInfos.get(documentId, sel.page);
      if (!d || !sel || !info || (d.dx === 0 && d.dy === 0)) return;
      if (sel.kind === "text") {
        const box = info.boxes[sel.id];
        if (box) void moveTextBox(wbRef.current, documentId, sel.page, box, d.dx, d.dy);
      } else {
        const img = info.images[sel.id];
        if (img)
          void placeImageEdit(
            wbRef.current,
            documentId,
            sel.page,
            img,
            { ...img.placement, cx: img.placement.cx + d.dx, cy: img.placement.cy + d.dy },
            "Move image",
          );
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[
        e.key
      ];
      if (!step || e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      const sel = editSelection.get(documentId);
      if (!sel || sel.more?.length || editSession.get(documentId) || wbRef.current.busy) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const n = e.shiftKey ? 10 : 1;
      const d = nudge.get(documentId) ?? { dx: 0, dy: 0 };
      nudge.set(documentId, { dx: d.dx + (step[0] ?? 0) * n, dy: d.dy + (step[1] ?? 0) * n });
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, NUDGE_WAIT);
    };
    // Capture: ahead of the page-turning arrow keys.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (timer) {
        window.clearTimeout(timer);
        flush();
      }
    };
  }, [documentId, editing]);

  return null;
}
