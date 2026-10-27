// Places the armed workpaper item (flyerStore) where the user clicks on this page. A
// tickmark stays armed (click, click, click... Esc stops); a legend box goes once.
import { useEffect, useRef, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import {
  useInteractionManager,
  usePointerHandlers,
} from "@embedpdf/plugin-interaction-manager/react";
import { PdfAnnotationSubtype, type PdfStampAnnoObject, type Position } from "@embedpdf/models";
import { useWorkbench } from "../../app/workbench";
import { drawTickmark, sequenceLabel } from "../../engine/flyer/tickmarks";
import { nextSequence, tickmarkSubject, type PwData } from "../../flyer/items";
import { pushRecent } from "../../flyer/library";
import { FLYER_MODE, flyerPlacement, lastSequence, usePendingItem } from "./flyerStore";

const exact = (u: Uint8Array) =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export function FlyerLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const wb = useWorkbench();
  const { provides: im, state: imState } = useInteractionManager(documentId);
  const active = imState.activeMode === FLYER_MODE;
  const { register } = usePointerHandlers({ documentId, pageIndex, modeId: FLYER_MODE });
  const { provides: scope, state } = useAnnotation(documentId);
  const doc = useDocumentState(documentId);
  const scale = doc?.scale ?? 1;
  const pageSize = doc?.document?.pages[pageIndex]?.size;
  const item = usePendingItem();
  const [cursor, setCursor] = useState<Position | null>(null);
  const latest = useRef({ scope, im, pageSize, state, wb });
  useEffect(() => {
    latest.current = { scope, im, pageSize, state, wb };
  });

  useEffect(() => {
    if (!active) return;
    return register({
      onPointerMove: (pos) => setCursor(pos),
      onPointerLeave: () => setCursor(null),
      onPointerDown: (pos) => {
        const p = flyerPlacement.get();
        const { scope: sc, im: m, pageSize: size, state: st, wb: w } = latest.current;
        if (!p || !sc || !size) return;
        let label: string | undefined;
        let custom: PwData;
        let subject: string;
        let contents: string | undefined;
        if (p.kind === "tickmark") {
          const def = p.def;
          if (def.sequence) {
            const key = `${documentId}:${def.id}`;
            const annots = Object.values(st.byUid).map((t) => t.object);
            const n = Math.max(nextSequence(def, annots), (lastSequence.get(key) ?? 0) + 1);
            lastSequence.set(key, n);
            label = sequenceLabel(def.sequence, n);
          }
          custom = { pwType: "Tickmark", pwTick: def.id, ...(label ? { pwLabel: label } : {}) };
          subject = tickmarkSubject(def, label);
          contents = def.meaning;
          w.updateSettings({ recentTickmarks: pushRecent(w.settings.recentTickmarks, def.id) });
        } else {
          // A legend is placed once.
          flyerPlacement.set(null);
          m?.activateDefaultMode();
          custom = { pwType: "Legend" };
          subject = "Tickmark legend";
        }
        const art = p.kind === "tickmark" ? drawTickmark(p.def, label) : Promise.resolve(p.art);
        void art
          .then((a) => {
            // Centered on the click, kept on the page.
            const x = Math.min(Math.max(0, pos.x - a.width / 2), size.width - a.width);
            const y = Math.min(Math.max(0, pos.y - a.height / 2), size.height - a.height);
            const anno: PdfStampAnnoObject = {
              type: PdfAnnotationSubtype.STAMP,
              id: crypto.randomUUID(),
              pageIndex,
              rect: { origin: { x, y }, size: { width: a.width, height: a.height } },
              subject,
              ...(contents ? { contents } : {}),
              author: w.author,
              created: new Date(),
              modified: new Date(),
              flags: ["print"],
              custom,
            };
            sc.createAnnotation(pageIndex, anno, {
              data: exact(a.pdf),
              mimeType: "application/pdf",
            });
            if (p.kind === "legend") sc.selectAnnotation(pageIndex, anno.id);
          })
          .catch((e: unknown) =>
            w.toast(`Could not place it: ${e instanceof Error ? e.message : String(e)}`, "error"),
          );
      },
    });
  }, [active, register, pageIndex, documentId]);

  if (!active || !cursor || !item) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="flyer-ghost"
      style={{
        position: "absolute",
        left: (cursor.x - item.width / 2) * scale,
        top: (cursor.y - item.height / 2) * scale,
        width: item.width * scale,
        height: item.height * scale,
        border: "1px dashed #c00",
        pointerEvents: "none",
      }}
    />
  );
}
