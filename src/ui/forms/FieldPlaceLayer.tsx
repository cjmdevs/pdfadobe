// Prepare Form (Phase 6): places the armed field kind where the user clicks on this page,
// at its default size, centred on the click. An outline follows the pointer. One field
// per pick; each placement is one undoable step (engine addField).
import { useEffect, useRef, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import {
  useInteractionManager,
  usePointerHandlers,
} from "@embedpdf/plugin-interaction-manager/react";
import type { Position } from "@embedpdf/models";
import { useWorkbench } from "../../app/workbench";
import { DEFAULT_SIZE } from "../../engine/forms";
import { placeField } from "./prepareActions";
import { FIELD_MODE, prepare, usePrepare } from "./prepareStore";

export function FieldPlaceLayer({
  documentId,
  pageIndex,
}: {
  documentId: string;
  pageIndex: number;
}) {
  const wb = useWorkbench();
  const { provides: im, state: imState } = useInteractionManager(documentId);
  const active = imState.activeMode === FIELD_MODE;
  const { register } = usePointerHandlers({ documentId, pageIndex, modeId: FIELD_MODE });
  const doc = useDocumentState(documentId);
  const scale = doc?.scale ?? 1;
  const pageSize = doc?.document?.pages[pageIndex]?.size;
  const { pending } = usePrepare(documentId);
  const [cursor, setCursor] = useState<Position | null>(null);
  const latest = useRef({ wb, pageSize, im });
  useEffect(() => {
    latest.current = { wb, pageSize, im };
  });

  useEffect(() => {
    if (!active) return;
    return register({
      onPointerMove: (pos) => setCursor(pos),
      onPointerLeave: () => setCursor(null),
      onPointerDown: (pos) => {
        const kind = prepare.pending(documentId);
        const { wb: w, pageSize: size, im: m } = latest.current;
        if (!kind || !size) return;
        prepare.arm(documentId, null);
        // Back to normal clicks: the next click selects a field instead of placing.
        m?.activateDefaultMode();
        const { w: fw, h: fh } = DEFAULT_SIZE[kind];
        // Centred on the click, kept on the page; page space has y down, PDF space y up.
        const x = Math.min(Math.max(0, pos.x - fw / 2), size.width - fw);
        const y = Math.min(Math.max(0, pos.y - fh / 2), size.height - fh);
        const t = size.height - y;
        void placeField(w, documentId, kind, pageIndex, { l: x, b: t - fh, r: x + fw, t });
      },
    });
  }, [active, register, documentId, pageIndex]);

  if (!active || !pending || !cursor) return null;
  const { w, h } = DEFAULT_SIZE[pending];
  return (
    <div
      className="field-place-outline"
      style={{
        left: (cursor.x - w / 2) * scale,
        top: (cursor.y - h / 2) * scale,
        width: w * scale,
        height: h * scale,
      }}
    />
  );
}
