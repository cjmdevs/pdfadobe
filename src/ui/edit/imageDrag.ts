// Edit PDF (B3): image handle geometry, in PDF points (y up). Pure, so it is tested
// without a page. An image is its placement: centre, size and rotation (degrees,
// counter-clockwise). Handles: four corners (resize; the opposite corner stays put and
// the picture keeps its proportions unless Shift is held), a rotate handle above the
// top edge (Shift snaps to 15°), and the image itself (move).
import type { Placement } from "../../engine/edit";

export type Handle = "nw" | "ne" | "se" | "sw" | "rotate" | "move";

export interface Pt {
  x: number;
  y: number;
}

/** Smallest side while resizing (points). */
const MIN = 4;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Image-local (x right, y up, origin at the centre) to page coordinates. */
function toPage(p: Placement, lx: number, ly: number): Pt {
  const c = Math.cos(rad(p.rotation));
  const s = Math.sin(rad(p.rotation));
  return { x: p.cx + lx * c - ly * s, y: p.cy + lx * s + ly * c };
}

function toLocal(p: Placement, pt: Pt): Pt {
  const c = Math.cos(rad(p.rotation));
  const s = Math.sin(rad(p.rotation));
  const dx = pt.x - p.cx;
  const dy = pt.y - p.cy;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

const SIGNS: Record<"nw" | "ne" | "se" | "sw", [number, number]> = {
  nw: [-1, 1],
  ne: [1, 1],
  se: [1, -1],
  sw: [-1, -1],
};

/** Where each handle sits on the page; `gap` is the rotate handle's distance above the top. */
export function handlePoints(p: Placement, gap: number): Record<Exclude<Handle, "move">, Pt> {
  const corner = (h: keyof typeof SIGNS) =>
    toPage(p, (SIGNS[h][0] * p.width) / 2, (SIGNS[h][1] * p.height) / 2);
  return {
    nw: corner("nw"),
    ne: corner("ne"),
    se: corner("se"),
    sw: corner("sw"),
    rotate: toPage(p, 0, p.height / 2 + gap),
  };
}

/** The handle under `pt` (within `tol` points), the image itself ("move"), or null. */
export function hitHandle(p: Placement, pt: Pt, tol: number, gap: number): Handle | null {
  const hs = handlePoints(p, gap);
  for (const h of ["rotate", "nw", "ne", "se", "sw"] as const) {
    if (Math.hypot(hs[h].x - pt.x, hs[h].y - pt.y) <= tol) return h;
  }
  const l = toLocal(p, pt);
  return Math.abs(l.x) <= p.width / 2 && Math.abs(l.y) <= p.height / 2 ? "move" : null;
}

/** The placement after dragging `handle` from `from` to `to`. */
export function dragPlacement(
  start: Placement,
  handle: Handle,
  from: Pt,
  to: Pt,
  shift: boolean,
): Placement {
  if (handle === "move")
    return { ...start, cx: start.cx + to.x - from.x, cy: start.cy + to.y - from.y };
  if (handle === "rotate") {
    const a0 = Math.atan2(from.y - start.cy, from.x - start.cx);
    const a1 = Math.atan2(to.y - start.cy, to.x - start.cx);
    let rotation = start.rotation + ((a1 - a0) * 180) / Math.PI;
    if (shift) rotation = Math.round(rotation / 15) * 15;
    rotation = ((((rotation + 180) % 360) + 360) % 360) - 180;
    return { ...start, rotation };
  }
  // Resize: the opposite corner stays fixed, in the image's own axes.
  const [sx, sy] = SIGNS[handle];
  const fixed = { x: (-sx * start.width) / 2, y: (-sy * start.height) / 2 };
  const moved = toLocal(start, to);
  let w = Math.max(MIN, (moved.x - fixed.x) * sx);
  let h = Math.max(MIN, (moved.y - fixed.y) * sy);
  if (!shift) {
    // Keep the proportions: follow whichever side the pointer pulls further.
    const k = Math.max(w / start.width, h / start.height);
    w = Math.max(MIN, start.width * k);
    h = Math.max(MIN, start.height * k);
  }
  const centreLocal = { x: fixed.x + (sx * w) / 2, y: fixed.y + (sy * h) / 2 };
  const c = toPage(start, centreLocal.x, centreLocal.y);
  return { cx: c.x, cy: c.y, width: w, height: h, rotation: start.rotation };
}

/** Size of a new image: its pixels at 96 dpi, no wider than half the page. */
export function naturalSize(
  px: { width: number; height: number },
  pageWidth: number,
): { width: number; height: number } {
  const w = px.width * 0.75;
  const k = Math.min(1, pageWidth / 2 / w);
  return { width: w * k, height: px.height * 0.75 * k };
}
