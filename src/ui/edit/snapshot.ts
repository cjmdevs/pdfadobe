// Edit PDF drag preview: which part of the page to take a picture of, and how sharp.
// Pure (no DOM): rects are PDF points with a bottom-left origin, like the engine's.
import type { Rect } from "../../engine/edit";

/** Room around the box so glyphs that reach past it are not cut (points). */
export const SHOT_PAD = 2;
/** The most device pixels per point a preview is drawn at (a 6400 % zoom stays cheap). */
export const SHOT_MAX_SCALE = 4;

/** The box plus a little room, kept on the page. Null when nothing of it is on the page. */
export function shotArea(rect: Rect, page: { width: number; height: number }): Rect | null {
  const out = {
    l: Math.max(0, rect.l - SHOT_PAD),
    b: Math.max(0, rect.b - SHOT_PAD),
    r: Math.min(page.width, rect.r + SHOT_PAD),
    t: Math.min(page.height, rect.t + SHOT_PAD),
  };
  return out.r - out.l >= 1 && out.t - out.b >= 1 ? out : null;
}

/** The same area the way the renderer takes it: top-left origin, width and height. */
export function toPageRect(rect: Rect, pageHeight: number) {
  return {
    origin: { x: rect.l, y: pageHeight - rect.t },
    size: { width: rect.r - rect.l, height: rect.t - rect.b },
  };
}

/** Zoom and screen density for the picture, capped at SHOT_MAX_SCALE between them. */
export function shotScale(scale: number, dpr: number): { scaleFactor: number; dpr: number } {
  const density = Math.max(1, dpr);
  return { scaleFactor: Math.min(scale, SHOT_MAX_SCALE / density), dpr: density };
}
