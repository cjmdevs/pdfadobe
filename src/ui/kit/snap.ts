// Snap guides (B8). Pure geometry, no DOM: boxes are in page units (PDF points, origin at
// the page's top-left, y down, as the page layers draw them). A moving or resizing box
// snaps an edge or its centre to the page edges, the page centre, or the edges and centres
// of other objects on the page, when within `threshold` (callers pass ~6 screen pixels
// divided by the zoom). Holding Alt turns snapping off (callers skip the call).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A guide line to draw: vertical at x = `at` (axis "x") or horizontal at y = `at`. */
export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

export interface Snapped {
  box: Box;
  guides: Guide[];
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface Line {
  at: number;
  /** Extent of the object the line belongs to, along the other axis (for drawing). */
  from: number;
  to: number;
}

function lines(boxes: Box[], page: { w: number; h: number }, axis: "x" | "y"): Line[] {
  const out: Line[] = [];
  const all = [{ x: 0, y: 0, w: page.w, h: page.h }, ...boxes];
  for (const b of all) {
    const [p, s, q, t] = axis === "x" ? [b.x, b.w, b.y, b.h] : [b.y, b.h, b.x, b.w];
    for (const at of [p, p + s / 2, p + s]) out.push({ at, from: q, to: q + t });
  }
  return out;
}

/** Best offset that brings one of `edges` onto a line, or null if none is close. */
function best(
  edges: number[],
  targets: Line[],
  threshold: number,
): { delta: number; at: number; line: Line } | null {
  let hit: { delta: number; at: number; line: Line } | null = null;
  for (const e of edges)
    for (const l of targets) {
      const d = l.at - e;
      if (Math.abs(d) <= threshold && (!hit || Math.abs(d) < Math.abs(hit.delta)))
        hit = { delta: d, at: l.at, line: l };
    }
  return hit;
}

function guide(axis: "x" | "y", at: number, box: Box, line: Line): Guide {
  const [q, t] = axis === "x" ? [box.y, box.h] : [box.x, box.w];
  return { axis, at, from: Math.min(q, line.from), to: Math.max(q + t, line.to) };
}

/** Snaps a box being moved. `others` must not include the box itself. */
export function snapMove(
  box: Box,
  others: Box[],
  page: { w: number; h: number },
  threshold: number,
): Snapped {
  const out = { ...box };
  const guides: Guide[] = [];
  const hx = best([box.x, box.x + box.w / 2, box.x + box.w], lines(others, page, "x"), threshold);
  if (hx) out.x += hx.delta;
  const hy = best([box.y, box.y + box.h / 2, box.y + box.h], lines(others, page, "y"), threshold);
  if (hy) out.y += hy.delta;
  if (hx) guides.push(guide("x", hx.at, out, hx.line));
  if (hy) guides.push(guide("y", hy.at, out, hy.line));
  return { box: out, guides };
}

/** Snaps the edges a resize handle moves; the opposite edges stay put. */
export function snapResize(
  box: Box,
  handle: Handle,
  others: Box[],
  page: { w: number; h: number },
  threshold: number,
  minSize = 1,
): Snapped {
  const out = { ...box };
  const guides: Guide[] = [];
  const xs = lines(others, page, "x");
  const ys = lines(others, page, "y");
  if (handle.includes("w")) {
    const h = best([box.x], xs, threshold);
    if (h && box.w - h.delta >= minSize) {
      out.x += h.delta;
      out.w -= h.delta;
      guides.push(guide("x", h.at, out, h.line));
    }
  } else if (handle.includes("e")) {
    const h = best([box.x + box.w], xs, threshold);
    if (h && box.w + h.delta >= minSize) {
      out.w += h.delta;
      guides.push(guide("x", h.at, out, h.line));
    }
  }
  if (handle.includes("n")) {
    const h = best([box.y], ys, threshold);
    if (h && box.h - h.delta >= minSize) {
      out.y += h.delta;
      out.h -= h.delta;
      guides.push(guide("y", h.at, out, h.line));
    }
  } else if (handle.includes("s")) {
    const h = best([box.y + box.h], ys, threshold);
    if (h && box.h + h.delta >= minSize) {
      out.h += h.delta;
      guides.push(guide("y", h.at, out, h.line));
    }
  }
  return { box: out, guides };
}

/** Snaps a single point (the corner being drawn when a new box is dragged out). */
export function snapPoint(
  p: { x: number; y: number },
  others: Box[],
  page: { w: number; h: number },
  threshold: number,
): { x: number; y: number; guides: Guide[] } {
  const zero = { x: p.x, y: p.y, w: 0, h: 0 };
  const hx = best([p.x], lines(others, page, "x"), threshold);
  const hy = best([p.y], lines(others, page, "y"), threshold);
  const x = p.x + (hx?.delta ?? 0);
  const y = p.y + (hy?.delta ?? 0);
  const at = { ...zero, x, y };
  const guides: Guide[] = [];
  if (hx) guides.push(guide("x", hx.at, at, hx.line));
  if (hy) guides.push(guide("y", hy.at, at, hy.line));
  return { x, y, guides };
}

/** Screen pixels within which an edge snaps. */
export const SNAP_PX = 6;
