// Places the armed workpaper item (flyerStore) where the user clicks on this page.
// Tickmarks, user/status stamps and connectors stay armed (click, click... Esc stops); a
// legend box goes once. A connector takes two clicks: start, then end (on this page or
// another one); a click on an annotation attaches that end to it. With the calculator, a
// click on an amount sends it, and foot/cross-foot drags around amounts, then takes the
// total; a calculator tape is placed once.
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
import { pushRecent, tickRef } from "../../flyer/library";
import { foot, sendAmount } from "../../flyer/calc";
import { matchingTickmarks } from "../../flyer/tickLinks";
import { tapeAnnotation } from "../../flyer/tapeRows";
import { calcStore, useCalcView } from "./calcStore";
import { numberAt, numbersIn, numbersOn, type ShownNumber } from "./pageNumbers";
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
export function placeArt(
  sc: Scope,
  wb: WorkbenchApi,
  pageIndex: number,
  size: Size,
  pos: Position,
  art: StampDrawing,
  meta: { subject: string; contents?: string; custom: PwData; id?: string },
): PdfStampAnnoObject {
  const x = Math.min(Math.max(0, pos.x - art.width / 2), size.width - art.width);
  const y = Math.min(Math.max(0, pos.y - art.height / 2), size.height - art.height);
  const anno: PdfStampAnnoObject = {
    type: PdfAnnotationSubtype.STAMP,
    id: meta.id ?? crypto.randomUUID(),
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
      // Belongs to the marker (/IRT): clicks go through to it; deleted with it.
      inReplyToId: marker.id,
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
  // Calculator modes: this page's amounts, and the foot/cross-foot drag.
  const wantsNumbers = active && (item?.kind === "pick" || item?.kind === "foot");
  const [nums, setNums] = useState<ShownNumber[]>([]);
  const [drag, setDrag] = useState<{ from: Position; to: Position } | null>(null);
  const dragRef = useRef<{ from: Position; to: Position } | null>(null);
  const { footing } = useCalcView();
  useEffect(() => {
    if (!wantsNumbers) return;
    let live = true;
    numbersOn(wb, documentId, pageIndex).then(
      (list) => live && setNums(list),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wantsNumbers, wb, documentId, pageIndex]);
  const latest = useRef({ scope, im, pageSize, state, wb, doc });
  useEffect(() => {
    latest.current = { scope, im, pageSize, state, wb, doc };
  });

  useEffect(() => {
    if (!active) return;
    return register({
      onPointerMove: (pos) => {
        setCursor(pos);
        if (dragRef.current) {
          dragRef.current = { ...dragRef.current, to: pos };
          setDrag(dragRef.current);
        }
      },
      onPointerLeave: () => setCursor(null),
      onPointerUp: () => {
        const d0 = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        if (!d0) return;
        const r = {
          origin: { x: Math.min(d0.from.x, d0.to.x), y: Math.min(d0.from.y, d0.to.y) },
          size: { width: Math.abs(d0.to.x - d0.from.x), height: Math.abs(d0.to.y - d0.from.y) },
        };
        void numbersOn(latest.current.wb, documentId, pageIndex).then((list) => {
          const picked = numbersIn(list, r);
          if (!picked.length) {
            latest.current.wb.toast("No amounts in that area (scanned pages need OCR first).");
            return;
          }
          calcStore.set({
            footing: {
              documentId,
              pageIndex,
              stage: "total",
              values: picked.map((n) => n.value),
              rects: picked.map((n) => n.rect),
              across: r.size.width > r.size.height,
              result: null,
              totalRect: null,
            },
          });
          latest.current.wb.toast(
            `${picked.length} amount(s) selected. Click the total to compare, or No total in the calculator.`,
          );
        });
      },
      onPointerDown: (pos, evt) => {
        const p = flyerPlacement.get();
        const { scope: sc, im: m, pageSize: size, state: st, wb: w, doc: d } = latest.current;
        if (!p || !sc || !size) return;
        const annots = Object.values(st.byUid).map((t) => t.object);
        const fail = (e: unknown) =>
          w.toast(`Could not place it: ${e instanceof Error ? e.message : String(e)}`, "error");

        // The page's amounts may still be loading on the first click: wait for them.
        const amounts = () => numbersOn(w, documentId, pageIndex);
        if (p.kind === "pick") {
          const subtract = evt.shiftKey;
          void amounts().then((list) => {
            const n = numberAt(list, pos.x, pos.y);
            if (!n) return;
            const cfg = latest.current.wb.settings.calc;
            calcStore.set({ calc: sendAmount(calcStore.get().calc, n.value, subtract, cfg) });
          });
          return;
        }

        if (p.kind === "foot") {
          const f = calcStore.get().footing;
          if (f?.stage === "total" && f.documentId === documentId) {
            void amounts().then((list) => {
              const n = numberAt(list, pos.x, pos.y);
              if (!n) return;
              // The total is not one of the amounts it totals.
              const keep = f.rects
                .map((r, i) => ({ r, v: f.values[i] ?? 0 }))
                .filter(
                  ({ r }) => r.origin.x !== n.rect.origin.x || r.origin.y !== n.rect.origin.y,
                );
              const values = keep.map((k) => k.v);
              calcStore.set({
                footing: {
                  ...f,
                  stage: "done",
                  values,
                  rects: keep.map((k) => k.r),
                  result: foot(values, n.value, f.across),
                  totalRect: n.rect,
                },
              });
              flyerPlacement.set(null);
              m?.activateDefaultMode();
            });
            return;
          }
          dragRef.current = { from: pos, to: pos };
          setDrag(dragRef.current);
          return;
        }

        if (p.kind === "tape") {
          flyerPlacement.set(null);
          m?.activateDefaultMode();
          const cfg = w.settings.calc;
          const anno = tapeAnnotation(
            calcStore.get().calc.tape,
            cfg.decimals,
            cfg.tapeColor,
            { pageIndex, x: pos.x - p.width / 2, y: pos.y - p.height / 2, page: size },
            w.author,
          );
          sc.createAnnotation(pageIndex, anno);
          sc.selectAnnotation(pageIndex, anno.id);
          return;
        }

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
        let label: string | undefined = def.variable ? p.label : undefined;
        if (def.sequence) {
          const key = `${documentId}:${def.id}`;
          const n = Math.max(nextSequence(def, annots), (lastSequence.get(key) ?? 0) + 1);
          lastSequence.set(key, n);
          label = sequenceLabel(def.sequence, n);
        }
        const ref = tickRef(def.id, def.variable ? label : undefined);
        w.updateSettings({ recentTickmarks: pushRecent(w.settings.recentTickmarks, ref) });
        drawTickmark(def, label)
          .then((art) =>
            placeArt(sc, w, pageIndex, size, pos, art, {
              subject: tickmarkSubject(def, label),
              contents: def.meaning,
              custom: {
                pwType: "Tickmark",
                pwTick: def.id,
                ...(label ? { pwLabel: label } : {}),
                // Matching letters/numbers link to each other (FlyerOverlay).
                ...(def.variable ? { pwLink: true } : {}),
              },
            }),
          )
          .catch(fail);
      },
    });
  }, [active, register, pageIndex, documentId]);

  // Footing in progress or done on this page: the selected amounts and the total.
  const marks =
    footing && footing.documentId === documentId && footing.pageIndex === pageIndex
      ? footing
      : null;
  const box = (r: { origin: Position; size: Size }, color: string, key: string) => (
    <div
      key={key}
      style={{
        position: "absolute",
        left: r.origin.x * scale - 1,
        top: r.origin.y * scale - 1,
        width: r.size.width * scale + 2,
        height: r.size.height * scale + 2,
        background: color,
        pointerEvents: "none",
      }}
    />
  );
  const footLayer = marks && (
    <div aria-hidden="true" data-testid="foot-marks">
      {marks.rects.map((r, i) => box(r, "rgb(0 120 255 / 0.18)", `f${i}`))}
      {marks.totalRect && box(marks.totalRect, "rgb(0 160 60 / 0.25)", "total")}
    </div>
  );
  // A selected letter/number tickmark: rings around the others with the same value.
  const [one, ...others] = state.selectedUids;
  const picked = one && !others.length ? state.byUid[one]?.object : undefined;
  const matches = picked
    ? matchingTickmarks(
        Object.values(state.byUid).map((t) => t.object),
        picked,
      ).filter((a) => a.pageIndex === pageIndex && a.id !== picked.id)
    : [];
  const ringLayer = matches.length > 0 && (
    <div aria-hidden="true" data-testid="match-rings">
      {matches.map((a) => (
        <div
          key={a.id}
          className="match-ring"
          style={{
            position: "absolute",
            left: a.rect.origin.x * scale - 4,
            top: a.rect.origin.y * scale - 4,
            width: a.rect.size.width * scale + 8,
            height: a.rect.size.height * scale + 8,
            pointerEvents: "none",
          }}
        />
      ))}
    </div>
  );
  if (!active || !item)
    return footLayer || ringLayer ? (
      <>
        {footLayer}
        {ringLayer}
      </>
    ) : null;
  if (item.kind === "pick" || item.kind === "foot") {
    const hover = cursor ? numberAt(nums, cursor.x, cursor.y) : null;
    return (
      <>
        {footLayer}
        {hover && box(hover.rect, "rgb(255 200 0 / 0.35)", "hover")}
        {drag && (
          <div
            data-testid="foot-drag"
            style={{
              position: "absolute",
              left: Math.min(drag.from.x, drag.to.x) * scale,
              top: Math.min(drag.from.y, drag.to.y) * scale,
              width: Math.abs(drag.to.x - drag.from.x) * scale,
              height: Math.abs(drag.to.y - drag.from.y) * scale,
              border: "1px dashed #0060c0",
              pointerEvents: "none",
            }}
          />
        )}
      </>
    );
  }
  // Connector: a line from the start (on this page) to the pointer.
  if (item.kind === "connector") {
    if (!start || start.documentId !== documentId || start.pageIndex !== pageIndex)
      return footLayer || null;
    const to = cursor ?? start;
    return (
      <>
        {footLayer}
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
      </>
    );
  }
  if (!cursor) return footLayer || null;
  return (
    <>
      {footLayer}
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
    </>
  );
}
