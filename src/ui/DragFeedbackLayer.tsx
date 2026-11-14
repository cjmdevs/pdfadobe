// Drag feedback on the page (B8). DragFeedbackLayer (one per page) draws the X/Y W/H
// readout and snap guides that src/ui/dragFeedback.ts holds. AnnotationSnap (one per
// document) does the same for comments and marks, which EmbedPDF moves and resizes
// itself: it wraps the annotation plugin's updateDrag / updateResize so the delta or box
// they get is snapped first (page edges, page centre, other comments), and publishes the
// box while the drag lasts. Alt turns snapping off.
import { useEffect, useRef } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation, useAnnotationPlugin } from "@embedpdf/plugin-annotation/react";
import type { Position, Rect } from "@embedpdf/models";
import { useWorkbench } from "../app/workbench";
import type { Settings } from "../app/settings";
import { BoxReadout, SnapGuides } from "./kit/DragFeedback";
import { snapMove, snapResize, type Box, type Handle } from "./kit/snap";
import {
  annotationBoxes,
  boxToRect,
  dragFeedback,
  rectToBox,
  snapOn,
  snapThreshold,
  usePageFeedback,
} from "./dragFeedback";

export function DragFeedbackLayer({
  documentId,
  pageIndex,
}: {
  documentId: string;
  pageIndex: number;
}) {
  const f = usePageFeedback(documentId, pageIndex);
  const scale = useDocumentState(documentId)?.scale ?? 1;
  const { settings } = useWorkbench();
  if (!f) return null;
  return (
    <div className="drag-feedback-layer" aria-hidden="true">
      <SnapGuides guides={f.guides} scale={scale} />
      {settings.showBoxReadout && (
        <BoxReadout box={f.box} scale={scale} units={settings.units} size={f.size} />
      )}
    </div>
  );
}

interface DocCtx {
  pages: { width: number; height: number }[];
  state: {
    pages: Record<number, string[]>;
    byUid: Record<string, { object: { id: string; rect: Rect; pageIndex: number } } | undefined>;
  };
  settings: Settings;
  scale: number;
}

const ctxByDoc = new Map<string, DocCtx>();

interface DragPlugin {
  updateDrag(documentId: string, rawDelta: Position): Position;
  updateResize(documentId: string, box: Rect): Record<string, Rect>;
  getDragState(documentId: string): {
    primaryIds: string[];
    allParticipantIds: string[];
    originalRects: Map<string, Rect>;
  } | null;
  getResizeState(documentId: string): {
    primaryIds: string[];
    allParticipantIds: string[];
    resizeHandle: string;
  } | null;
  onDragChange: (cb: (e: { documentId: string; type: string }) => void) => () => void;
  onResizeChange: (cb: (e: { documentId: string; type: string }) => void) => () => void;
  __pwSnap?: boolean;
}

function pageOf(ctx: DocCtx, ids: string[]): number | null {
  for (const v of Object.values(ctx.state.byUid))
    if (v && ids.includes(v.object.id)) return v.object.pageIndex;
  return null;
}

function union(rects: Rect[]): Box | null {
  if (!rects.length) return null;
  let l = Infinity,
    t = Infinity,
    r = -Infinity,
    b = -Infinity;
  for (const x of rects) {
    l = Math.min(l, x.origin.x);
    t = Math.min(t, x.origin.y);
    r = Math.max(r, x.origin.x + x.size.width);
    b = Math.max(b, x.origin.y + x.size.height);
  }
  return { x: l, y: t, w: r - l, h: b - t };
}

const HANDLES = new Set(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);

/** Wraps the plugin once; the wrapper looks up the document's context each call. */
function install(plugin: DragPlugin) {
  if (plugin.__pwSnap) return;
  plugin.__pwSnap = true;
  const drag = plugin.updateDrag.bind(plugin);
  const resize = plugin.updateResize.bind(plugin);
  plugin.updateDrag = (documentId, raw) => {
    const ctx = ctxByDoc.get(documentId);
    const st = plugin.getDragState(documentId);
    const page = ctx && st ? pageOf(ctx, st.primaryIds) : null;
    const start = st ? union([...st.originalRects.values()]) : null;
    if (!ctx || !st || page === null || !start) return drag(documentId, raw);
    const size = ctx.pages[page] ?? { width: 612, height: 792 };
    const moved = { ...start, x: start.x + raw.x, y: start.y + raw.y };
    let delta = raw;
    let guides: ReturnType<typeof snapMove>["guides"] = [];
    if (snapOn(ctx.settings)) {
      const others = annotationBoxes(ctx.state, page, new Set(st.allParticipantIds));
      const s = snapMove(
        moved,
        others,
        { w: size.width, h: size.height },
        snapThreshold(ctx.settings, ctx.scale),
      );
      delta = { x: s.box.x - start.x, y: s.box.y - start.y };
      guides = s.guides;
    }
    const out = drag(documentId, delta);
    // The plugin may clamp to the page; draw where it really went.
    const box = { ...start, x: start.x + out.x, y: start.y + out.y };
    dragFeedback.set({ documentId, pageIndex: page, box, guides, size: false });
    return out;
  };
  plugin.updateResize = (documentId, box) => {
    const ctx = ctxByDoc.get(documentId);
    const st = plugin.getResizeState(documentId);
    const page = ctx && st ? pageOf(ctx, st.primaryIds) : null;
    if (!ctx || !st || page === null) return resize(documentId, box);
    const size = ctx.pages[page] ?? { width: 612, height: 792 };
    let b = rectToBox(box);
    let guides: ReturnType<typeof snapResize>["guides"] = [];
    if (snapOn(ctx.settings) && HANDLES.has(st.resizeHandle)) {
      const others = annotationBoxes(ctx.state, page, new Set(st.allParticipantIds));
      const s = snapResize(
        b,
        st.resizeHandle as Handle,
        others,
        { w: size.width, h: size.height },
        snapThreshold(ctx.settings, ctx.scale),
      );
      b = s.box;
      guides = s.guides;
    }
    const out = resize(documentId, boxToRect(b));
    dragFeedback.set({ documentId, pageIndex: page, box: b, guides, size: true });
    return out;
  };
  const end = (e: { type: string }) => {
    if (e.type === "end" || e.type === "cancel") dragFeedback.clear();
  };
  plugin.onDragChange(end);
  plugin.onResizeChange(end);
}

/** Mount once per open document (inside its EmbedPDF context). */
export function AnnotationSnap({ documentId }: { documentId: string }) {
  const { plugin } = useAnnotationPlugin();
  const { state } = useAnnotation(documentId);
  const docState = useDocumentState(documentId);
  const { settings } = useWorkbench();
  const pages = docState?.document?.pages;
  const scale = docState?.scale ?? 1;
  const ref = useRef<DocCtx | null>(null);
  useEffect(() => {
    ref.current = {
      pages: (pages ?? []).map((p) => ({ width: p.size.width, height: p.size.height })),
      state: state as unknown as DocCtx["state"],
      settings,
      scale,
    };
    ctxByDoc.set(documentId, ref.current);
  });
  useEffect(() => () => void ctxByDoc.delete(documentId), [documentId]);
  useEffect(() => {
    if (plugin) install(plugin as unknown as DragPlugin);
  }, [plugin]);
  return null;
}
