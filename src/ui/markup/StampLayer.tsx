// Places the picked stamp (stampPlacement) where the user clicks on this page; an
// outline follows the pointer meanwhile. One stamp per pick, like Acrobat.
import { useEffect, useRef, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import {
  useInteractionManager,
  usePointerHandlers,
} from "@embedpdf/plugin-interaction-manager/react";
import { PdfAnnotationSubtype, type PdfStampAnnoObject, type Position } from "@embedpdf/models";
import { useWorkbench } from "../../app/workbench";
import { STAMP_MODE } from "../../markup/config";
import { stampPlacement, usePendingStamp } from "./stampPlacement";
import { usePageSnapper } from "../dragFeedback";

export function StampLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const wb = useWorkbench();
  const { provides: im, state: imState } = useInteractionManager(documentId);
  const active = imState.activeMode === STAMP_MODE;
  const { register } = usePointerHandlers({ documentId, pageIndex, modeId: STAMP_MODE });
  const { provides: scope } = useAnnotation(documentId);
  const doc = useDocumentState(documentId);
  const scale = doc?.scale ?? 1;
  const pageSize = doc?.document?.pages[pageIndex]?.size;
  const stamp = usePendingStamp();
  const [cursor, setCursor] = useState<Position | null>(null);
  const snap = usePageSnapper(documentId, pageIndex);
  const latest = useRef({ scope, im, pageSize, author: wb.author, toast: wb.toast });
  useEffect(() => {
    latest.current = { scope, im, pageSize, author: wb.author, toast: wb.toast };
  });

  useEffect(() => {
    if (!active) return;
    return register({
      onPointerMove: (pos) => {
        const s = stampPlacement.get();
        if (!s) return setCursor(pos);
        const c = snap.centred(pos, s.width, s.height);
        setCursor(c);
        snap.show(c.box, c.guides, false);
      },
      onPointerLeave: () => {
        setCursor(null);
        snap.clear();
      },
      onPointerDown: (raw) => {
        const s = stampPlacement.get();
        snap.clear();
        const pos = s ? snap.centred(raw, s.width, s.height) : raw;
        const { scope: sc, im: m, pageSize: size, author, toast } = latest.current;
        if (!s || !sc || !size) return;
        stampPlacement.set(null);
        m?.activateDefaultMode();
        const who = author;
        void s
          .make(who)
          .then((art) => {
            // Centered on the click, kept on the page.
            const x = Math.min(Math.max(0, pos.x - art.width / 2), size.width - art.width);
            const y = Math.min(Math.max(0, pos.y - art.height / 2), size.height - art.height);
            const anno: PdfStampAnnoObject = {
              type: PdfAnnotationSubtype.STAMP,
              id: crypto.randomUUID(),
              pageIndex,
              rect: { origin: { x, y }, size: { width: art.width, height: art.height } },
              name: s.name,
              subject: s.subject,
              author: who,
              created: new Date(),
              modified: new Date(),
              flags: ["print"],
            };
            sc.createAnnotation(pageIndex, anno, { data: art.data, mimeType: art.mime });
            sc.selectAnnotation(pageIndex, anno.id);
          })
          .catch((e: unknown) =>
            toast(
              `Could not place the stamp: ${e instanceof Error ? e.message : String(e)}`,
              "error",
            ),
          );
      },
    });
  }, [active, register, pageIndex, snap]);

  if (!active || !cursor || !stamp) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="stamp-ghost"
      style={{
        position: "absolute",
        left: (cursor.x - stamp.width / 2) * scale,
        top: (cursor.y - stamp.height / 2) * scale,
        width: stamp.width * scale,
        height: stamp.height * scale,
        border: "1px dashed #555",
        background: "rgb(255 255 255 / 0.3)",
        pointerEvents: "none",
      }}
    />
  );
}
