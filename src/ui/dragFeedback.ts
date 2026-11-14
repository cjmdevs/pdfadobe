// Live drag feedback on the page (B8): the box being dragged (page points, top-left
// origin) and the snap guides in effect. Layers that move or draw boxes publish here;
// one DragFeedbackLayer per page draws the X/Y W/H readout and the guide lines. Also
// tracks whether Alt is held (Alt turns snapping off) and builds snap targets from the
// comments and marks on a page.
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import type { Rect } from "@embedpdf/models";
import type { Settings } from "../app/settings";
import { useWorkbench } from "../app/workbench";
import { snapMove, snapPoint, snapResize, type Box, type Guide, type Handle } from "./kit/snap";

export interface PageFeedback {
  documentId: string;
  pageIndex: number;
  box: Box;
  guides: Guide[];
  /** Show W/H too (resizing or drawing); moving shows X/Y only. */
  size: boolean;
}

let current: PageFeedback | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const dragFeedback = {
  set(f: PageFeedback) {
    current = f;
    emit();
  },
  clear() {
    if (!current) return;
    current = null;
    emit();
  },
  get: () => current,
};

export function usePageFeedback(documentId: string, pageIndex: number): PageFeedback | null {
  const f = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return f && f.documentId === documentId && f.pageIndex === pageIndex ? f : null;
}

let alt = false;
if (typeof window !== "undefined") {
  const track = (e: KeyboardEvent | PointerEvent | MouseEvent) => {
    alt = e.altKey;
  };
  window.addEventListener("keydown", track, true);
  window.addEventListener("keyup", track, true);
  window.addEventListener("pointermove", track, true);
  window.addEventListener("pointerdown", track, true);
  window.addEventListener("blur", () => (alt = false));
}

/** Snapping is on (Preferences) and Alt is not held. */
export function snapOn(settings: Pick<Settings, "snapToGuides">): boolean {
  return settings.snapToGuides && !alt;
}

/** Snap distance in page points at this zoom. */
export function snapThreshold(settings: Pick<Settings, "snapDistance">, scale: number): number {
  return settings.snapDistance / Math.max(scale, 0.01);
}

export function rectToBox(r: Rect): Box {
  return { x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height };
}

export function boxToRect(b: Box): Rect {
  return { origin: { x: b.x, y: b.y }, size: { width: b.w, height: b.h } };
}

/** Bounding boxes of the comments and marks on a page, except the given ids. */
export function annotationBoxes(
  state: {
    pages: Record<number, string[]>;
    byUid: Record<string, { object: { id: string; rect: Rect } } | undefined>;
  },
  pageIndex: number,
  except: ReadonlySet<string> = new Set(),
): Box[] {
  const out: Box[] = [];
  for (const uid of state.pages[pageIndex] ?? []) {
    const a = state.byUid[uid]?.object;
    if (!a || except.has(a.id) || except.has(uid)) continue;
    out.push(rectToBox(a.rect));
  }
  return out;
}

/**
 * Snap helpers for one page layer, stable across renders (they read the latest zoom,
 * settings, page size and comments when called from pointer handlers).
 */
export function usePageSnapper(documentId: string, pageIndex: number) {
  const { settings } = useWorkbench();
  const docState = useDocumentState(documentId);
  const { state } = useAnnotation(documentId);
  const latest = useRef({ settings, docState, state });
  useEffect(() => {
    latest.current = { settings, docState, state };
  });
  return useMemo(() => {
    const ctx = () => {
      const { settings: s, docState: d, state: a } = latest.current;
      const p = d?.document?.pages[pageIndex]?.size ?? { width: 612, height: 792 };
      return { s, scale: d?.scale ?? 1, page: { w: p.width, h: p.height }, a };
    };
    const others = (extra: Box[], except: ReadonlySet<string>) => {
      const { a } = ctx();
      return [...annotationBoxes(a as never, pageIndex, except), ...extra];
    };
    return {
      /** A corner being drawn (page points, top-left origin). */
      point(p: { x: number; y: number }, extra: Box[] = [], except = new Set<string>()) {
        const { s, scale, page } = ctx();
        if (!snapOn(s)) return { x: p.x, y: p.y, guides: [] as Guide[] };
        return snapPoint(p, others(extra, except), page, snapThreshold(s, scale));
      },
      move(b: Box, extra: Box[] = [], except = new Set<string>()) {
        const { s, scale, page } = ctx();
        if (!snapOn(s)) return { box: b, guides: [] as Guide[] };
        return snapMove(b, others(extra, except), page, snapThreshold(s, scale));
      },
      resize(b: Box, handle: Handle, extra: Box[] = [], except = new Set<string>()) {
        const { s, scale, page } = ctx();
        if (!snapOn(s)) return { box: b, guides: [] as Guide[] };
        return snapResize(b, handle, others(extra, except), page, snapThreshold(s, scale));
      },
      /** A box of size w x h centred on the pointer (placing a stamp or a field). */
      centred(p: { x: number; y: number }, w: number, h: number, extra: Box[] = []) {
        const b = { x: p.x - w / 2, y: p.y - h / 2, w, h };
        const { s, scale, page } = ctx();
        const r = snapOn(s)
          ? snapMove(b, others(extra, new Set()), page, snapThreshold(s, scale))
          : { box: b, guides: [] as Guide[] };
        return { x: r.box.x + w / 2, y: r.box.y + h / 2, box: r.box, guides: r.guides };
      },
      show(box: Box, guides: Guide[], size: boolean) {
        dragFeedback.set({ documentId, pageIndex, box, guides, size });
      },
      clear: () => dragFeedback.clear(),
    };
  }, [documentId, pageIndex]);
}

/** The box two drawn corners span. */
export function spanBox(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}
