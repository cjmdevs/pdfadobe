// Vector paths partly under a redaction box (Phase 5, owner choice A: clip). Pure
// geometry: the part of a path inside the box is cut away, the rest is kept exactly.
//
// Fills: each subpath is clipped (Sutherland-Hodgman) against the four strips around
// the box. The strips are convex and do not overlap, and clipping keeps each polygon's
// direction, so the even-odd and nonzero fill rules give the same result as before
// outside the box. Strokes: each segment loses its part inside the box (Liang-Barsky).
// Curves are flattened only in subpaths that touch the box.

import type { Rect } from "../edit/chars";

export interface Pt {
  x: number;
  y: number;
}

/** A subpath as PDF draws it: a start point, then lines or cubic curves. */
export interface SubPath {
  start: Pt;
  segs: ({ kind: "line"; to: Pt } | { kind: "curve"; c1: Pt; c2: Pt; to: Pt })[];
  closed: boolean;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.l < b.r && b.l < a.r && a.b < b.t && b.b < a.t;
}

export function rectInside(inner: Rect, outer: Rect): boolean {
  return inner.l >= outer.l && inner.r <= outer.r && inner.b >= outer.b && inner.t <= outer.t;
}

function points(sp: SubPath): Pt[] {
  const out = [sp.start];
  for (const s of sp.segs) {
    if (s.kind === "curve") out.push(s.c1, s.c2);
    out.push(s.to);
  }
  return out;
}

/** Bounds of a subpath's points (control points included, so it never under-reports). */
export function subBounds(sp: SubPath): Rect {
  const ps = points(sp);
  return {
    l: Math.min(...ps.map((p) => p.x)),
    b: Math.min(...ps.map((p) => p.y)),
    r: Math.max(...ps.map((p) => p.x)),
    t: Math.max(...ps.map((p) => p.y)),
  };
}

const CURVE_STEPS = 24;

/** The subpath as a polyline (closing point not repeated). */
export function flatten(sp: SubPath): Pt[] {
  const out: Pt[] = [sp.start];
  let p = sp.start;
  for (const s of sp.segs) {
    if (s.kind === "line") out.push(s.to);
    else {
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS;
        const u = 1 - t;
        out.push({
          x: u * u * u * p.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.to.x,
          y: u * u * u * p.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.to.y,
        });
      }
    }
    p = s.to;
  }
  return out;
}

function polyline(pts: Pt[], closed: boolean): SubPath {
  const [start, ...rest] = pts;
  return {
    start: start ?? { x: 0, y: 0 },
    segs: rest.map((to) => ({ kind: "line" as const, to })),
    closed,
  };
}

/** Sutherland-Hodgman: the part of polygon `poly` inside the axis-aligned `win`. */
export function clipPolygon(poly: Pt[], win: Rect): Pt[] {
  type Edge = { inside: (p: Pt) => boolean; cross: (a: Pt, b: Pt) => Pt };
  const atX = (a: Pt, b: Pt, x: number): Pt => ({
    x,
    y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x),
  });
  const atY = (a: Pt, b: Pt, y: number): Pt => ({
    x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y),
    y,
  });
  const edges: Edge[] = [
    { inside: (p) => p.x >= win.l, cross: (a, b) => atX(a, b, win.l) },
    { inside: (p) => p.x <= win.r, cross: (a, b) => atX(a, b, win.r) },
    { inside: (p) => p.y >= win.b, cross: (a, b) => atY(a, b, win.b) },
    { inside: (p) => p.y <= win.t, cross: (a, b) => atY(a, b, win.t) },
  ];
  let out = poly;
  for (const e of edges) {
    const input = out;
    const next: Pt[] = [];
    input.forEach((cur, i) => {
      const prev = input[(i + input.length - 1) % input.length] ?? cur;
      if (e.inside(cur)) {
        if (!e.inside(prev)) next.push(e.cross(prev, cur));
        next.push(cur);
      } else if (e.inside(prev)) next.push(e.cross(prev, cur));
    });
    out = next;
    if (!out.length) break;
  }
  return out;
}

/** The four non-overlapping strips around `box`, out to `outer`. */
function stripsAround(box: Rect, outer: Rect): Rect[] {
  const o = { l: outer.l - 1, b: outer.b - 1, r: outer.r + 1, t: outer.t + 1 };
  return [
    { l: o.l, b: box.t, r: o.r, t: o.t },
    { l: o.l, b: o.b, r: o.r, t: box.b },
    { l: o.l, b: box.b, r: box.l, t: box.t },
    { l: box.r, b: box.b, r: o.r, t: box.t },
  ].filter((s) => s.r > s.l && s.t > s.b);
}

function area(poly: Pt[]): number {
  let a = 0;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length] ?? p;
    a += p.x * q.y - q.x * p.y;
  });
  return a / 2;
}

/** A filled path with the part inside `box` removed. Untouched subpaths keep curves. */
export function fillOutside(subs: SubPath[], box: Rect): SubPath[] {
  const out: SubPath[] = [];
  for (const sp of subs) {
    const b = subBounds(sp);
    if (!rectsOverlap(b, box)) {
      out.push(sp);
      continue;
    }
    if (rectInside(b, box)) continue;
    const poly = flatten(sp);
    for (const strip of stripsAround(box, b)) {
      const piece = clipPolygon(poly, strip);
      if (piece.length >= 3 && Math.abs(area(piece)) > 1e-6) out.push(polyline(piece, true));
    }
  }
  return out;
}

/** Liang-Barsky: the [t0, t1] part of segment a-b inside `box`, or null. */
function insideSpan(a: Pt, b: Pt, box: Rect): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const tests: [number, number][] = [
    [-dx, a.x - box.l],
    [dx, box.r - a.x],
    [-dy, a.y - box.b],
    [dy, box.t - a.y],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

type Seg = SubPath["segs"][number];

function pointAt(from: Pt, s: Seg, t: number): Pt {
  if (s.kind === "line") return lerp(from, s.to, t);
  const u = 1 - t;
  return {
    x: u * u * u * from.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.to.x,
    y: u * u * u * from.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.to.y,
  };
}

/** The [t0, t1] part of a segment, exactly (de Casteljau for curves). */
function subSeg(from: Pt, s: Seg, t0: number, t1: number): { start: Pt; seg: Seg } {
  if (s.kind === "line")
    return { start: lerp(from, s.to, t0), seg: { kind: "line", to: lerp(from, s.to, t1) } };
  const split = (p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number) => {
    const a = lerp(p0, c1, t);
    const b = lerp(c1, c2, t);
    const c = lerp(c2, p3, t);
    const d = lerp(a, b, t);
    const e = lerp(b, c, t);
    const f = lerp(d, e, t);
    return { left: [p0, a, d, f] as const, right: [f, e, c, p3] as const };
  };
  let [p0, c1, c2, p3] = [from, s.c1, s.c2, s.to];
  if (t0 > 0) [p0, c1, c2, p3] = split(p0, c1, c2, p3, t0).right;
  const rel = t0 < 1 ? (t1 - t0) / (1 - t0) : 1;
  if (rel < 1) [p0, c1, c2, p3] = split(p0, c1, c2, p3, rel).left;
  return { start: p0, seg: { kind: "curve", c1, c2, to: p3 } };
}

function segLength(from: Pt, s: Seg, t0 = 0, t1 = 1): number {
  const steps = s.kind === "line" ? 1 : 32;
  let len = 0;
  let prev = pointAt(from, s, t0);
  for (let i = 1; i <= steps; i++) {
    const p = pointAt(from, s, t0 + ((t1 - t0) * i) / steps);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

const strictlyIn = (p: Pt, r: Rect) => p.x > r.l && p.x < r.r && p.y > r.b && p.y < r.t;

/** The parts of a segment outside `box`, as [t0, t1] intervals. */
function outsideSpans(from: Pt, s: Seg, box: Rect): [number, number][] {
  if (s.kind === "line") {
    const span = insideSpan(from, s.to, box);
    if (!span) return [[0, 1]];
    const out: [number, number][] = [];
    if (span[0] > 1e-9) out.push([0, span[0]]);
    if (span[1] < 1 - 1e-9) out.push([span[1], 1]);
    return out;
  }
  // Curves: sample, then bisect each in/out change to 1e-7.
  const N = 256;
  const inside = (t: number) => strictlyIn(pointAt(from, s, t), box);
  const edges: number[] = [];
  let prevIn = inside(0);
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const cur = inside(t);
    if (cur !== prevIn) {
      let lo = (i - 1) / N;
      let hi = t;
      while (hi - lo > 1e-7) {
        const mid = (lo + hi) / 2;
        if (inside(mid) === prevIn) lo = mid;
        else hi = mid;
      }
      edges.push(prevIn ? hi : lo);
    }
    prevIn = cur;
  }
  const out: [number, number][] = [];
  let open: number | null = inside(0) ? null : 0;
  let state = inside(0);
  for (const e of edges) {
    if (!state && open !== null) {
      out.push([open, e]);
      open = null;
    } else open = e;
    state = !state;
  }
  if (!state && open !== null) out.push([open, 1]);
  return out.filter(([a, b]) => b - a > 1e-9);
}

/** A stroke piece kept outside a box; `dashOffset` is how far along its subpath it starts. */
export interface StrokePiece extends SubPath {
  dashOffset: number;
}

/**
 * A stroked path with the part inside `box` removed. Kept pieces are exact (curves are
 * split, not flattened) and know their distance along the original subpath, so a dash
 * pattern carries on where it was. Pass a box grown by half the line width so the
 * stroke's edge and caps do not reach into the original box.
 */
export function strokeOutside(subs: SubPath[], box: Rect): StrokePiece[] {
  const out: StrokePiece[] = [];
  for (const sp of subs) {
    const b = subBounds(sp);
    if (!rectsOverlap(b, box)) {
      out.push({ ...sp, dashOffset: 0 });
      continue;
    }
    if (rectInside(b, box)) continue;
    const segs: { from: Pt; seg: Seg }[] = [];
    let from = sp.start;
    for (const seg of sp.segs) {
      segs.push({ from, seg });
      from = seg.to;
    }
    if (sp.closed && (from.x !== sp.start.x || from.y !== sp.start.y)) {
      segs.push({ from, seg: { kind: "line", to: sp.start } });
    }
    const pieces: StrokePiece[] = [];
    let cur: StrokePiece | null = null;
    let cut = false;
    let walked = 0;
    for (const { from: f, seg } of segs) {
      const spans = outsideSpans(f, seg, box);
      const only = spans.length === 1 ? spans[0] : undefined;
      if (!only || only[0] !== 0 || only[1] !== 1) cut = true;
      for (const [t0, t1] of spans) {
        const part = subSeg(f, seg, t0, t1);
        if (cur && t0 === 0) cur.segs.push(part.seg);
        else {
          cur = {
            start: part.start,
            segs: [part.seg],
            closed: false,
            dashOffset: walked + segLength(f, seg, 0, t0),
          };
          pieces.push(cur);
        }
        if (t1 !== 1) cur = null;
      }
      if (!spans.length) cur = null;
      walked += segLength(f, seg);
    }
    if (!cut) {
      // The box only sits in a gap (inside a frame, say): nothing was cut.
      out.push({ ...sp, dashOffset: 0 });
      continue;
    }
    // A closed subpath: the last piece runs on into the first.
    const first = pieces[0];
    const last = pieces[pieces.length - 1];
    if (sp.closed && first && last && first !== last && first.dashOffset === 0 && cur === last) {
      last.segs.push(...first.segs);
      pieces.shift();
    }
    out.push(...pieces);
  }
  return out;
}
