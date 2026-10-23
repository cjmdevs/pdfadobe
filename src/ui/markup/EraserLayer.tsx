// Ink eraser on one page (Phase 3). Active while the interaction mode is ERASER_MODE:
// drag over ink to erase that part of it. One undo step per drag.
import { useEffect, useRef, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import {
  useInteractionManager,
  usePointerHandlers,
} from "@embedpdf/plugin-interaction-manager/react";
import { PdfAnnotationSubtype, type PdfInkAnnoObject, type Position } from "@embedpdf/models";
import { ERASER_MODE } from "../../markup/config";
import { eraseStrokes, inkRect } from "../../markup/eraser";

/** Eraser radius on screen (pixels); converted to page points at the current zoom. */
const RADIUS_PX = 8;

export function EraserLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const { state: im } = useInteractionManager(documentId);
  const active = im.activeMode === ERASER_MODE;
  const { register } = usePointerHandlers({ documentId, pageIndex, modeId: ERASER_MODE });
  const { provides: scope, state } = useAnnotation(documentId);
  const scale = useDocumentState(documentId)?.scale ?? 1;
  const path = useRef<Position[] | null>(null);
  const [cursor, setCursor] = useState<Position | null>(null);
  const radius = RADIUS_PX / scale;

  // Latest values for the handlers registered once below.
  const latest = useRef({ scope, state, radius });
  useEffect(() => {
    latest.current = { scope, state, radius };
  });

  useEffect(() => {
    if (!active) return;
    const apply = () => {
      const erased = path.current;
      path.current = null;
      const { scope: s, state: st, radius: r } = latest.current;
      if (!erased?.length || !s) return;
      const patches: { pageIndex: number; id: string; patch: Partial<PdfInkAnnoObject> }[] = [];
      const gone: { pageIndex: number; id: string }[] = [];
      for (const uid of st.pages[pageIndex] ?? []) {
        const a = st.byUid[uid]?.object;
        if (a?.type !== PdfAnnotationSubtype.INK || a.flags?.includes("locked")) continue;
        const ink = a as PdfInkAnnoObject;
        const next = eraseStrokes(
          ink.inkList.map((l) => l.points),
          erased,
          r,
          ink.strokeWidth,
        );
        if (!next) continue;
        if (!next.length) gone.push({ pageIndex, id: ink.id });
        else
          patches.push({
            pageIndex,
            id: ink.id,
            patch: {
              inkList: next.map((points) => ({ points })),
              rect: inkRect(next, ink.strokeWidth),
            },
          });
      }
      if (patches.length) s.updateAnnotations(patches);
      if (gone.length) s.deleteAnnotations(gone);
    };
    return register({
      onPointerDown: (pos, evt) => {
        evt.setPointerCapture?.();
        path.current = [pos];
      },
      onPointerMove: (pos) => {
        setCursor(pos);
        path.current?.push(pos);
      },
      onPointerUp: (_pos, evt) => {
        evt.releasePointerCapture?.();
        apply();
      },
      onPointerLeave: () => setCursor(null),
      onPointerCancel: () => {
        path.current = null;
      },
    });
  }, [active, register, pageIndex]);

  if (!active || !cursor) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="eraser-cursor"
      style={{
        position: "absolute",
        left: (cursor.x - radius) * scale,
        top: (cursor.y - radius) * scale,
        width: radius * 2 * scale,
        height: radius * 2 * scale,
        borderRadius: "50%",
        border: "1px solid #444",
        background: "rgb(255 255 255 / 0.4)",
        pointerEvents: "none",
      }}
    />
  );
}
