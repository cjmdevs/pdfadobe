// Connectors (Phase 4 stage 2): a line or arrow between two points or two annotations.
// An end attached to an annotation follows it (our app re-routes the line when either
// annotation moves); a connector between two pages becomes a marker on each page with a
// /Link to the other end, so the jump also works in Acrobat. Node-safe geometry.

import {
  PdfAnnotationBorderStyle,
  PdfAnnotationLineEnding,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type Position,
  type Rect,
} from "@embedpdf/models";
import { pwData } from "./items";

export interface ConnectorStyle {
  id: string;
  label: string;
  start: PdfAnnotationLineEnding;
  end: PdfAnnotationLineEnding;
  dashed: boolean;
}

export const CONNECTOR_STYLES: readonly ConnectorStyle[] = [
  {
    id: "arrow",
    label: "Arrow",
    start: PdfAnnotationLineEnding.None,
    end: PdfAnnotationLineEnding.OpenArrow,
    dashed: false,
  },
  {
    id: "line",
    label: "Line",
    start: PdfAnnotationLineEnding.None,
    end: PdfAnnotationLineEnding.None,
    dashed: false,
  },
  {
    id: "double",
    label: "Double arrow",
    start: PdfAnnotationLineEnding.OpenArrow,
    end: PdfAnnotationLineEnding.OpenArrow,
    dashed: false,
  },
  {
    id: "dashed",
    label: "Dashed arrow",
    start: PdfAnnotationLineEnding.None,
    end: PdfAnnotationLineEnding.OpenArrow,
    dashed: true,
  },
  {
    id: "dot",
    label: "Dot to arrow",
    start: PdfAnnotationLineEnding.Circle,
    end: PdfAnnotationLineEnding.ClosedArrow,
    dashed: false,
  },
];

export const CONNECTOR_COLOR = "#D0021B";
export const CONNECTOR_WIDTH = 1.5;

export function connectorLook(style: ConnectorStyle) {
  return {
    strokeColor: CONNECTOR_COLOR,
    color: "transparent",
    opacity: 1,
    strokeWidth: CONNECTOR_WIDTH,
    strokeStyle: style.dashed ? PdfAnnotationBorderStyle.DASHED : PdfAnnotationBorderStyle.SOLID,
    ...(style.dashed ? { strokeDashArray: [4, 3] } : {}),
    lineEndings: { start: style.start, end: style.end },
  };
}

const center = (r: Rect): Position => ({
  x: r.origin.x + r.size.width / 2,
  y: r.origin.y + r.size.height / 2,
});

/** Where the ray from `r`'s centre toward `to` leaves `r`, `gap` points further out. The
 * gap keeps the line's click area (EmbedPDF: 20 px wide) off the tickmark it points at,
 * so the tickmark can still be clicked and moved. */
export function edgePoint(r: Rect, to: Position, gap = 8): Position {
  const c = center(r);
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = r.size.width / 2;
  const hh = r.size.height / 2;
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  const len = Math.hypot(dx, dy);
  const k = Math.min(1, t + gap / len);
  return { x: c.x + dx * k, y: c.y + dy * k };
}

/** End points between two ends, each a point or an annotation's rect. */
export function route(
  from: Position | Rect,
  to: Position | Rect,
): { start: Position; end: Position } {
  const isRect = (v: Position | Rect): v is Rect => "origin" in v;
  const aim = (v: Position | Rect) => (isRect(v) ? center(v) : v);
  return {
    start: isRect(from) ? edgePoint(from, aim(to)) : from,
    end: isRect(to) ? edgePoint(to, aim(from)) : to,
  };
}

/** Annotation rect around a line, with room for its arrowheads. */
export function lineRect(start: Position, end: Position, width = CONNECTOR_WIDTH): Rect {
  const m = width * 4 + 4;
  const x = Math.min(start.x, end.x) - m;
  const y = Math.min(start.y, end.y) - m;
  return {
    origin: { x, y },
    size: {
      width: Math.abs(start.x - end.x) + m * 2,
      height: Math.abs(start.y - end.y) + m * 2,
    },
  };
}

const inside = (r: Rect, p: Position) =>
  p.x >= r.origin.x &&
  p.x <= r.origin.x + r.size.width &&
  p.y >= r.origin.y &&
  p.y <= r.origin.y + r.size.height;

/** The annotation a connector end attaches to at `p` (smallest one under it), if any.
 * Lines, links and connector markers are never targets. */
export function attachTarget(
  annots: PdfAnnotationObject[],
  pageIndex: number,
  p: Position,
): PdfAnnotationObject | null {
  let best: PdfAnnotationObject | null = null;
  for (const a of annots) {
    if (a.pageIndex !== pageIndex || !inside(a.rect, p)) continue;
    if (a.type === PdfAnnotationSubtype.LINE || a.type === PdfAnnotationSubtype.LINK) continue;
    if (pwData(a)?.pwType === "Connector") continue;
    const area = a.rect.size.width * a.rect.size.height;
    if (!best || area < best.rect.size.width * best.rect.size.height) best = a;
  }
  return best;
}

export interface Reroute {
  pageIndex: number;
  id: string;
  patch: Partial<PdfAnnotationObject>;
}

const far = (p: Position, q: Position) => Math.abs(p.x - q.x) > 0.5 || Math.abs(p.y - q.y) > 0.5;

/**
 * What must change so connectors still meet the annotations they are attached to, and
 * jump links still cover their markers (deleted markers take their link with them:
 * `patch` null).
 */
export function reroutes(annots: PdfAnnotationObject[]): {
  update: Reroute[];
  remove: { pageIndex: number; id: string }[];
} {
  const byId = new Map(annots.map((a) => [a.id, a]));
  const update: Reroute[] = [];
  const remove: { pageIndex: number; id: string }[] = [];
  for (const a of annots) {
    const d = pwData(a);
    if (d?.pwType === "Connector" && a.type === PdfAnnotationSubtype.LINE) {
      const from = d.pwFrom ? byId.get(d.pwFrom) : undefined;
      const to = d.pwTo ? byId.get(d.pwTo) : undefined;
      if (!from && !to) continue;
      const lp = (a as { linePoints: { start: Position; end: Position } }).linePoints;
      const r = route(from?.rect ?? lp.start, to?.rect ?? lp.end);
      if (far(r.start, lp.start) || far(r.end, lp.end))
        update.push({
          pageIndex: a.pageIndex,
          id: a.id,
          patch: {
            linePoints: r,
            rect: lineRect(r.start, r.end, (a as { strokeWidth?: number }).strokeWidth),
          } as Partial<PdfAnnotationObject>,
        });
    }
    if (d?.pwType === "ConnectorLink" && d.pwPair && d.pwEnd) {
      const marker = annots.find((m) => {
        const md = pwData(m);
        return md?.pwType === "Connector" && md.pwPair === d.pwPair && md.pwEnd === d.pwEnd;
      });
      if (!marker) remove.push({ pageIndex: a.pageIndex, id: a.id });
      else if (far(marker.rect.origin, a.rect.origin))
        update.push({ pageIndex: a.pageIndex, id: a.id, patch: { rect: marker.rect } });
    }
  }
  return { update, remove };
}
