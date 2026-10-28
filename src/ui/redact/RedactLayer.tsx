// Redaction marks on one page (Phase 5): pending marks are outlined red, accepted ones
// filled. While "Draw box" is on (REDACT_MODE), a drag makes a new mark.
import { useEffect, useRef, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import {
  useInteractionManager,
  usePointerHandlers,
} from "@embedpdf/plugin-interaction-manager/react";
import type { Position } from "@embedpdf/models";
import { useWorkbench } from "../../app/workbench";
import { MARK_COLOR, addMark, marksOf } from "./marks";
import { REDACT_MODE, redactMarks, useRedactVersion } from "./redactStore";

export function RedactLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const wb = useWorkbench();
  const { state: imState } = useInteractionManager(documentId);
  const active = imState.activeMode === REDACT_MODE;
  const { register } = usePointerHandlers({ documentId, pageIndex, modeId: REDACT_MODE });
  const { provides: scope, state } = useAnnotation(documentId);
  const scale = useDocumentState(documentId)?.scale ?? 1;
  useRedactVersion();
  const [drag, setDrag] = useState<{ from: Position; to: Position } | null>(null);
  const dragRef = useRef<{ from: Position; to: Position } | null>(null);
  const latest = useRef({ scope, wb });
  useEffect(() => {
    latest.current = { scope, wb };
  });

  useEffect(() => {
    if (!active) return;
    return register({
      onPointerDown: (pos) => {
        dragRef.current = { from: pos, to: pos };
        setDrag(dragRef.current);
      },
      onPointerMove: (pos) => {
        if (!dragRef.current) return;
        dragRef.current = { ...dragRef.current, to: pos };
        setDrag(dragRef.current);
      },
      onPointerUp: () => {
        const d = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        const { scope: sc, wb: w } = latest.current;
        if (!d || !sc) return;
        const width = Math.abs(d.to.x - d.from.x);
        const height = Math.abs(d.to.y - d.from.y);
        if (width < 3 || height < 3) return;
        const rect = {
          origin: { x: Math.min(d.from.x, d.to.x), y: Math.min(d.from.y, d.to.y) },
          size: { width, height },
        };
        addMark(sc, documentId, pageIndex, [rect], { source: "manual" }, w.author);
      },
    });
  }, [active, register, documentId, pageIndex]);

  const marks = marksOf(Object.values(state.byUid).map((t) => t.object)).filter(
    (m) => m.pageIndex === pageIndex,
  );
  const box = (r: { origin: Position; size: { width: number; height: number } }) => ({
    left: r.origin.x * scale,
    top: r.origin.y * scale,
    width: r.size.width * scale,
    height: r.size.height * scale,
  });

  return (
    <div className="redact-layer" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {marks.flatMap((m) => {
        const accepted = redactMarks.accepted(documentId, m.id);
        return m.rects.map((r, i) => (
          <div
            key={`${m.id}-${i}`}
            data-testid="redact-mark"
            data-accepted={accepted}
            style={{
              position: "absolute",
              ...box(r),
              border: `1.5px ${accepted ? "solid" : "dashed"} ${MARK_COLOR}`,
              background: accepted ? "rgba(208, 51, 108, 0.35)" : "rgba(208, 51, 108, 0.08)",
            }}
          />
        ));
      })}
      {drag && (
        <div
          data-testid="redact-drag"
          style={{
            position: "absolute",
            left: Math.min(drag.from.x, drag.to.x) * scale,
            top: Math.min(drag.from.y, drag.to.y) * scale,
            width: Math.abs(drag.to.x - drag.from.x) * scale,
            height: Math.abs(drag.to.y - drag.from.y) * scale,
            border: `1.5px dashed ${MARK_COLOR}`,
          }}
        />
      )}
    </div>
  );
}
