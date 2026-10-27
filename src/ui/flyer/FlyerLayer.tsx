// Places the armed workpaper item (flyerStore) where the user clicks on this page.
// Tickmarks, user/status stamps and connectors stay armed (click, click... Esc stops); a
// legend box goes once. A connector takes two clicks: start, then end (on this page or
// another one); a click on an annotation attaches that end to it.
import { useEffect, useRef, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import {
  useInteractionManager,
  usePointerHandlers,
} from "@embedpdf/plugin-interaction-manager/react";
import {
  PdfAnnotationSubtype,
  PdfZoomMode,
  type PdfAnnotationObject,
  type PdfLineAnnoObject,
  type PdfLinkAnnoObject,
  type PdfStampAnnoObject,
  type Position,
  type Size,
} from "@embedpdf/models";
import { useWorkbench, type WorkbenchApi } from "../../app/workbench";
import { drawTickmark, sequenceLabel } from "../../engine/flyer/tickmarks";
import {
  drawConnectorMarker,
  drawUserStamp,
  initialsOf,
  stampLines,
  type StampValues,
} from "../../engine/flyer/userStamps";
import type { StampDrawing } from "../../engine/stamps";
import {
  CONNECTOR_COLOR,
  attachTarget,
  connectorLook,
  lineRect,
  route,
} from "../../flyer/connectors";
import { nextSequence, tickmarkSubject, type PwData } from "../../flyer/items";
import { pushRecent } from "../../flyer/library";
import {
  FLYER_MODE,
  connectorStartStore,
  flyerPlacement,
  lastSequence,
  useConnectorStart,
  usePendingItem,
  type ConnectorStart,
  type PendingItem,
} from "./flyerStore";

const exact = (u: Uint8Array) =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

type Scope = NonNullable<ReturnType<typeof useAnnotation>["provides"]>;

/** Stamp values at this moment: the author, their initials, today's date and time. */
export function stampValues(
  wb: WorkbenchApi,
  ref: string,
  fields: Record<string, string>,
): StampValues {
  const now = new Date();
  return {
    name: wb.author,
    initials: wb.settings.userInitials ?? initialsOf(wb.author),
    date: now.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }),
    time: now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    ref,
    fields,
  };
}

/** A stamp annotation with `art` as its appearance, centred on `pos`, kept on the page. */
function placeArt(
  sc: Scope,
  wb: WorkbenchApi,
  pageIndex: number,
  size: Size,
  pos: Position,
  art: StampDrawing,
  meta: { subject: string; contents?: string; custom: PwData },
): PdfStampAnnoObject {
  const x = Math.min(Math.max(0, pos.x - art.width / 2), size.width - art.width);
  const y = Math.min(Math.max(0, pos.y - art.height / 2), size.height - art.height);
  const anno: PdfStampAnnoObject = {
    type: PdfAnnotationSubtype.STAMP,
    id: crypto.randomUUID(),
    pageIndex,
    rect: { origin: { x, y }, size: { width: art.width, height: art.height } },
    subject: meta.subject,
    ...(meta.contents ? { contents: meta.contents } : {}),
    author: wb.author,
    created: new Date(),
    modified: new Date(),
    flags: ["print"],
    custom: meta.custom,
  };
  sc.createAnnotation(pageIndex, anno, { data: exact(art.pdf), mimeType: "application/pdf" });
  return anno;
}

async function placeConnector(
  sc: Scope,
  wb: WorkbenchApi,
  p: Extract<PendingItem, { kind: "connector" }>,
  start: ConnectorStart,
  end: ConnectorStart,
  annots: PdfAnnotationObject[],
  pageSizes: (i: number) => Size | undefined,
) {
  const rectOf = (id: string | null) => (id ? annots.find((a) => a.id === id)?.rect : undefined);
  if (start.pageIndex === end.pageIndex) {
    const r = route(rectOf(start.attachId) ?? start, rectOf(end.attachId) ?? end);
    const anno: PdfLineAnnoObject = {
      type: PdfAnnotationSubtype.LINE,
      id: crypto.randomUUID(),
      pageIndex: end.pageIndex,
      rect: lineRect(r.start, r.end),
      linePoints: r,
      ...connectorLook(p.style),
      subject: "Connector",
      author: wb.author,
      created: new Date(),
      modified: new Date(),
      flags: ["print"],
      custom: {
        pwType: "Connector",
        ...(start.attachId ? { pwFrom: start.attachId } : {}),
        ...(end.attachId ? { pwTo: end.attachId } : {}),
      } satisfies PwData,
    };
    sc.createAnnotation(end.pageIndex, anno);
    return;
  }
  // Two pages: a marker at each end, each with a link to the other.
  const pair = crypto.randomUUID();
  const ends = [
    { at: start, other: end, which: "start" as const },
    { at: end, other: start, which: "end" as const },
  ];
  for (const e of ends) {
    const size = pageSizes(e.at.pageIndex);
    if (!size) continue;
    const art = await drawConnectorMarker(e.other.pageIndex + 1, e.which, CONNECTOR_COLOR);
    const marker = placeArt(sc, wb, e.at.pageIndex, size, e.at, art, {
      subject: `Connector ${e.which === "start" ? "to" : "from"} page ${e.other.pageIndex + 1}`,
      custom: { pwType: "Connector", pwPair: pair, pwEnd: e.which, pwPage: e.other.pageIndex + 1 },
    });
    const otherSize = pageSizes(e.other.pageIndex);
    const link: PdfLinkAnnoObject = {
      type: PdfAnnotationSubtype.LINK,
      id: crypto.randomUUID(),
      pageIndex: e.at.pageIndex,
      rect: marker.rect,
      strokeWidth: 0,
      target: {
        type: "destination",
        destination: {
          pageIndex: e.other.pageIndex,
          // PDF space (bottom-left origin); zoom 0 keeps the reader's zoom.
          zoom: {
            mode: PdfZoomMode.XYZ,
            params: {
              x: Math.max(0, e.other.x - 72),
              y: (otherSize?.height ?? 792) - Math.max(0, e.other.y - 72),
              zoom: 0,
            },
          },
          view: [],
        },
      },
      custom: { pwType: "ConnectorLink", pwPair: pair, pwEnd: e.which } satisfies PwData,
    };
    sc.createAnnotation(e.at.pageIndex, link);
  }
}

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
  const start = useConnectorStart();
  const [cursor, setCursor] = useState<Position | null>(null);
  const latest = useRef({ scope, im, pageSize, state, wb, doc });
  useEffect(() => {
    latest.current = { scope, im, pageSize, state, wb, doc };
  });

  useEffect(() => {
    if (!active) return;
    return register({
      onPointerMove: (pos) => setCursor(pos),
      onPointerLeave: () => setCursor(null),
      onPointerDown: (pos) => {
        const p = flyerPlacement.get();
        const { scope: sc, im: m, pageSize: size, state: st, wb: w, doc: d } = latest.current;
        if (!p || !sc || !size) return;
        const annots = Object.values(st.byUid).map((t) => t.object);
        const fail = (e: unknown) =>
          w.toast(`Could not place it: ${e instanceof Error ? e.message : String(e)}`, "error");

        if (p.kind === "connector") {
          const here: ConnectorStart = {
            documentId,
            pageIndex,
            x: pos.x,
            y: pos.y,
            attachId: attachTarget(annots, pageIndex, pos)?.id ?? null,
          };
          const first = connectorStartStore.get();
          if (!first || first.documentId !== documentId) {
            connectorStartStore.set(here);
            return;
          }
          connectorStartStore.set(null);
          w.updateSettings({ connectorStyle: p.style.id });
          const sizes = (i: number) => d?.document?.pages[i]?.size;
          placeConnector(sc, w, p, first, here, annots, sizes).catch(fail);
          return;
        }

        if (p.kind === "legend") {
          // A legend is placed once.
          flyerPlacement.set(null);
          m?.activateDefaultMode();
          const anno = placeArt(sc, w, pageIndex, size, pos, p.art, {
            subject: "Tickmark legend",
            custom: { pwType: "Legend" },
          });
          sc.selectAnnotation(pageIndex, anno.id);
          return;
        }

        if (p.kind === "stamp") {
          const t = p.template;
          const v = stampValues(w, p.ref, p.fields);
          const contents =
            t.kind === "user"
              ? `${v.initials} ${t.showDate ? v.date : ""}`.trim()
              : stampLines(t, v).join("; ");
          drawUserStamp(t, v)
            .then((art) =>
              placeArt(sc, w, pageIndex, size, pos, art, {
                subject: t.title,
                contents,
                custom: {
                  pwType: t.kind === "user" ? "UserStamp" : "StatusStamp",
                  pwStamp: t.id,
                },
              }),
            )
            .catch(fail);
          return;
        }

        const def = p.def;
        let label: string | undefined;
        if (def.sequence) {
          const key = `${documentId}:${def.id}`;
          const n = Math.max(nextSequence(def, annots), (lastSequence.get(key) ?? 0) + 1);
          lastSequence.set(key, n);
          label = sequenceLabel(def.sequence, n);
        }
        w.updateSettings({ recentTickmarks: pushRecent(w.settings.recentTickmarks, def.id) });
        drawTickmark(def, label)
          .then((art) =>
            placeArt(sc, w, pageIndex, size, pos, art, {
              subject: tickmarkSubject(def, label),
              contents: def.meaning,
              custom: {
                pwType: "Tickmark",
                pwTick: def.id,
                ...(label ? { pwLabel: label } : {}),
              },
            }),
          )
          .catch(fail);
      },
    });
  }, [active, register, pageIndex, documentId]);

  if (!active || !item) return null;
  // Connector: a line from the start (on this page) to the pointer.
  if (item.kind === "connector") {
    if (!start || start.documentId !== documentId || start.pageIndex !== pageIndex) return null;
    const to = cursor ?? start;
    return (
      <svg
        aria-hidden="true"
        data-testid="connector-ghost"
        style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
        width="100%"
        height="100%"
      >
        <circle cx={start.x * scale} cy={start.y * scale} r={3} fill={CONNECTOR_COLOR} />
        <line
          x1={start.x * scale}
          y1={start.y * scale}
          x2={to.x * scale}
          y2={to.y * scale}
          stroke={CONNECTOR_COLOR}
          strokeDasharray="4 3"
        />
      </svg>
    );
  }
  if (!cursor) return null;
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
