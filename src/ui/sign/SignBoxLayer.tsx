// Digitally Sign (Phase 8): a drag on this page marks where the visible signature goes
// (a click alone uses the usual size, centred on it), then Sign with a Certificate opens.
import { useEffect, useRef, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import {
  useInteractionManager,
  usePointerHandlers,
} from "@embedpdf/plugin-interaction-manager/react";
import type { Position } from "@embedpdf/models";
import { useWorkbench } from "../../app/workbench";
import { SIGN_BOX_MODE } from "../../markup/config";

const USUAL = { width: 220, height: 60 };

export function SignBoxLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const wb = useWorkbench();
  const { provides: im, state: imState } = useInteractionManager(documentId);
  const active = imState.activeMode === SIGN_BOX_MODE;
  const { register } = usePointerHandlers({ documentId, pageIndex, modeId: SIGN_BOX_MODE });
  const doc = useDocumentState(documentId);
  const scale = doc?.scale ?? 1;
  const pageSize = doc?.document?.pages[pageIndex]?.size;
  const [drag, setDrag] = useState<{ a: Position; b: Position } | null>(null);
  const start = useRef<Position | null>(null);
  const latest = useRef({ wb, im, pageSize });
  useEffect(() => {
    latest.current = { wb, im, pageSize };
  });

  useEffect(() => {
    if (!active) return;
    return register({
      onPointerDown: (pos) => {
        start.current = pos;
        setDrag({ a: pos, b: pos });
      },
      onPointerMove: (pos) => {
        const a = start.current;
        if (a) setDrag({ a, b: pos });
      },
      onPointerUp: (pos) => {
        const { wb: w, im: m, pageSize: size } = latest.current;
        const a = start.current;
        start.current = null;
        setDrag(null);
        if (!a || !size) return;
        let x = Math.min(a.x, pos.x);
        let y = Math.min(a.y, pos.y);
        let width = Math.abs(pos.x - a.x);
        let height = Math.abs(pos.y - a.y);
        if (width < 20 || height < 10) {
          ({ width, height } = USUAL);
          x = pos.x - width / 2;
          y = pos.y - height / 2;
        }
        // Kept on the page; page space has y down, the signer's display space y up.
        x = Math.min(Math.max(0, x), Math.max(0, size.width - width));
        y = Math.min(Math.max(0, y), Math.max(0, size.height - height));
        m?.activateDefaultMode();
        w.setDialog({
          kind: "certSign",
          documentId,
          box: { page: pageIndex, rect: { x, y: size.height - y - height, width, height } },
          field: null,
        });
      },
    });
  }, [active, register, documentId, pageIndex]);

  if (!active || !drag) return null;
  const left = Math.min(drag.a.x, drag.b.x);
  const top = Math.min(drag.a.y, drag.b.y);
  return (
    <div
      className="sign-box-outline"
      data-testid="sign-box-outline"
      style={{
        left: left * scale,
        top: top * scale,
        width: Math.abs(drag.b.x - drag.a.x) * scale,
        height: Math.abs(drag.b.y - drag.a.y) * scale,
      }}
    />
  );
}
