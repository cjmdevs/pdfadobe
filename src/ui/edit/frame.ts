// Edit PDF (B3): a text box's frame (what the outline, handles and X/Y/W/H fields
// show) and what a change to it means for the text. Pure, so it is unit-tested.
//
// The text rect is the glyphs' box (editPageInfo's rect has a point of air on each
// side). The frame is the text rect plus the padding; with auto-fit off its height is
// fixed and may be shorter or taller than the text.
import type { EditTextBox, Rect } from "../../engine/edit";
import type { FrameSettings } from "./editStore";

/** editPageInfo pads each box by a point; the text itself is inside that. */
const AIR = 1;

export function textRectOf(b: EditTextBox): Rect {
  return { l: b.rect.l + AIR, r: b.rect.r - AIR, b: b.rect.b + AIR, t: b.rect.t - AIR };
}

export function frameOf(b: EditTextBox, f: FrameSettings): Rect {
  const t = textRectOf(b);
  const p = f.padding;
  const top = t.t + p;
  const fixed = !f.autoFit && f.height !== null;
  return { l: t.l - p, r: t.r + p, t: top, b: fixed ? top - (f.height ?? 0) : t.b - p };
}

/** With auto-fit off: the text (plus padding) is taller than the frame. */
export function overfull(b: EditTextBox, f: FrameSettings): boolean {
  if (f.autoFit || f.height === null) return false;
  const t = textRectOf(b);
  return t.t - t.b + 2 * f.padding > f.height + 0.5;
}

/** What it takes to give the text frame `next` (from a handle or the fields). */
export interface FrameChange {
  /** Re-wrap: new left text edge and width (points). */
  rewrap?: { left: number; width: number };
  /** Move the text up (+) or down (-). */
  dy?: number;
  /** Move the text sideways (no re-wrap). */
  dx?: number;
  /** New fixed height (auto-fit goes off). */
  height?: number;
}

const moved = (a: number, b: number) => Math.abs(a - b) > 0.25;

export function frameChange(b: EditTextBox, f: FrameSettings, next: Rect): FrameChange {
  const now = frameOf(b, f);
  const p = f.padding;
  const out: FrameChange = {};
  const width = next.r - next.l;
  // Same width somewhere else: a move. A new width: the text wraps again.
  if (moved(width, now.r - now.l))
    out.rewrap = { left: next.l + p, width: Math.max(12, width - 2 * p) };
  else if (moved(next.l, now.l)) out.dx = next.l - now.l;
  if (moved(next.t, now.t)) out.dy = next.t - now.t;
  if (moved(next.t - next.b, now.t - now.b)) out.height = Math.max(4, next.t - next.b);
  return out;
}

export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** The frame after dragging `edge` to `to` (page points, bottom-left origin). */
export function dragEdge(frame: Rect, edge: Edge, to: { x: number; y: number }): Rect {
  const r = { ...frame };
  const MIN = 12;
  if (edge.includes("w")) r.l = Math.min(to.x, r.r - MIN);
  if (edge.includes("e")) r.r = Math.max(to.x, r.l + MIN);
  if (edge.includes("n")) r.t = Math.max(to.y, r.b + 4);
  if (edge.includes("s")) r.b = Math.min(to.y, r.t - 4);
  return r;
}

/** The handle of `frame` under `p`, within `grab` points. */
export function edgeAt(frame: Rect, p: { x: number; y: number }, grab: number): Edge | null {
  const midX = (frame.l + frame.r) / 2;
  const midY = (frame.b + frame.t) / 2;
  const spots: [Edge, number, number][] = [
    ["nw", frame.l, frame.t],
    ["ne", frame.r, frame.t],
    ["sw", frame.l, frame.b],
    ["se", frame.r, frame.b],
    ["n", midX, frame.t],
    ["s", midX, frame.b],
    ["w", frame.l, midY],
    ["e", frame.r, midY],
  ];
  return spots.find(([, x, y]) => Math.hypot(p.x - x, p.y - y) <= grab)?.[0] ?? null;
}

/** Points to inches for the X/Y/W/H fields (2 decimals), and back. */
export const toInches = (pt: number) => Math.round((pt / 72) * 100) / 100;
export const fromInches = (inch: number) => inch * 72;

/** An image's crop rectangle on the page (it must be upright: rotation 0). */
export function cropRect(
  img: { rect: Rect; placement: { flip?: boolean } },
  part: { x0: number; y0: number; x1: number; y1: number },
): Rect {
  const w = img.rect.r - img.rect.l;
  const h = img.rect.t - img.rect.b;
  // A mirrored picture runs right to left.
  const [x0, x1] = img.placement.flip ? [1 - part.x1, 1 - part.x0] : [part.x0, part.x1];
  return {
    l: img.rect.l + x0 * w,
    r: img.rect.l + x1 * w,
    b: img.rect.b + part.y0 * h,
    t: img.rect.b + part.y1 * h,
  };
}

/** The part of the picture a crop rectangle keeps (fractions, clamped to the image). */
export function partOf(
  img: { rect: Rect; placement: { flip?: boolean } },
  r: Rect,
): { x0: number; y0: number; x1: number; y1: number } {
  const w = img.rect.r - img.rect.l;
  const h = img.rect.t - img.rect.b;
  const c = (v: number) => Math.min(1, Math.max(0, v));
  const a = c((r.l - img.rect.l) / w);
  const b = c((r.r - img.rect.l) / w);
  const [x0, x1] = img.placement.flip ? [1 - b, 1 - a] : [a, b];
  return { x0, x1, y0: c((r.b - img.rect.b) / h), y1: c((r.t - img.rect.b) / h) };
}
