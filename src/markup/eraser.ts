// Ink eraser geometry (Phase 3; EmbedPDF has no eraser). Erasing removes the part of each
// stroke the eraser passed over and splits the stroke there, like Acrobat's eraser.
// Page coordinates (EmbedPDF: points, top-left origin). No React here.

import type { Position, Rect } from "@embedpdf/models";

const dist2 = (a: Position, b: Position) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Squared distance from `p` to the segment a-b. */
function segDist2(p: Position, a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist2(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist2(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function nearPath(p: Position, path: Position[], r2: number): boolean {
  let prev: Position | undefined;
  for (const q of path) {
    if ((prev ? segDist2(p, prev, q) : dist2(p, q)) <= r2) return true;
    prev = q;
  }
  return false;
}

interface Pt extends Position {
  /** A point the user drew (kept), as opposed to one added to find the cut. */
  orig: boolean;
}

/** The stroke with extra points every `step` along each segment, so cuts land closely. */
function densify(stroke: Position[], step: number): Pt[] {
  const out: Pt[] = [];
  let a: Position | undefined;
  for (const p of stroke) {
    if (a) {
      const n = Math.floor(Math.sqrt(dist2(a, p)) / step);
      for (let k = 1; k < n; k++)
        out.push({ x: a.x + ((p.x - a.x) * k) / n, y: a.y + ((p.y - a.y) * k) / n, orig: false });
    }
    out.push({ x: p.x, y: p.y, orig: true });
    a = p;
  }
  return out;
}

/**
 * Strokes after erasing along `path` with an eraser of `radius` (the stroke's own
 * half-width counts too). Returns null when nothing was touched. Pieces shorter than
 * two points are dropped; an empty result means the whole annotation was erased.
 */
export function eraseStrokes(
  strokes: Position[][],
  path: Position[],
  radius: number,
  strokeWidth = 0,
): Position[][] | null {
  if (!path.length) return null;
  const r = radius + strokeWidth / 2;
  const r2 = r * r;
  let touched = false;
  const out: Position[][] = [];
  for (const stroke of strokes) {
    const pts = densify(stroke, Math.max(0.5, radius / 2));
    let piece: Pt[] = [];
    const flush = () => {
      // Keep the user's points and the two ends of each piece.
      const kept = piece.filter((p, i) => p.orig || i === 0 || i === piece.length - 1);
      if (kept.length >= 2) out.push(kept.map(({ x, y }) => ({ x, y })));
      piece = [];
    };
    for (const p of pts) {
      if (nearPath(p, path, r2)) {
        touched = true;
        flush();
      } else piece.push(p);
    }
    flush();
  }
  return touched ? out : null;
}

/** Bounding rect of the strokes, grown by half the pen width (plus 1 pt). */
export function inkRect(strokes: Position[][], strokeWidth: number): Rect {
  const all = strokes.flat();
  const pad = strokeWidth / 2 + 1;
  const x0 = Math.min(...all.map((p) => p.x)) - pad;
  const y0 = Math.min(...all.map((p) => p.y)) - pad;
  const x1 = Math.max(...all.map((p) => p.x)) + pad;
  const y1 = Math.max(...all.map((p) => p.y)) + pad;
  return { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } };
}
