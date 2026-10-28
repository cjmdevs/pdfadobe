// Edit PDF (B3): outlines around the page's text boxes and images while Edit mode is on,
// like Acrobat's Edit PDF. A click on text opens the in-place editor, a drag moves the
// box; the selected box's frame has 8 handles (sides re-wrap, top moves, bottom sets a
// fixed height); a click on an image selects it; a click on empty page clears the
// selection. In Add Text mode a
// click places one growing line, a drag sets the width to wrap at. The boxes come from
// the engine (editPageInfo) in the page worker, read from the store's current bytes.
import { useEffect, useRef, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import {
  useInteractionManager,
  usePointerHandlers,
} from "@embedpdf/plugin-interaction-manager/react";
import type { EditImage, EditPageInfo, EditTextBox, Placement, Rect } from "../../engine/edit";
import { hitTest } from "../../engine/edit/pageInfo";
import { pageOp } from "../../app/pages";
import { useWorkbench, type WorkbenchApi } from "../../app/workbench";
import {
  EDIT_MODE,
  addText,
  editSelection,
  editSession,
  pageInfos,
  reselect,
  useAddingText,
  overflowNote,
  pendingImage,
  useEditSelection,
  useOverflowNote,
  useEditSession,
  usePendingImage,
  useShowBoxes,
  editOptions,
  frameSettings,
  useFramesVersion,
  useNudge,
  type EditSelection,
} from "./editStore";
import { dragEdge, edgeAt, frameOf, overfull, type Edge } from "./frame";
import { TextEditor } from "./TextEditor";
import { dragPlacement, hitHandle, naturalSize, type Handle, type Pt } from "./imageDrag";
import { addImageEdit, applyFrame, moveTextBox, placeImageEdit } from "./editActions";

/** Store bytes per loaded document object: one read serves every page of the tab. */
const bytesFor = new WeakMap<object, Promise<Uint8Array | null>>();

function contentOf(wb: WorkbenchApi, documentId: string, doc: object) {
  let p = bytesFor.get(doc);
  if (!p) {
    p = wb.contentBytes(documentId);
    bytesFor.set(doc, p);
  }
  return p;
}

type Item = EditTextBox | EditImage;

/** A drag shorter than this (points) is a click. */
const DRAG = 8;
/** Pressing a text box: moving this many screen pixels starts a move instead of a click. */
const DRAG_PX = 4;
const EDGES: Edge[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
/** Handle grab radius and the rotate handle's distance above the image (screen pixels). */
const HANDLE = 7;
const ROTATE_GAP = 22;

const selectionOf = (page: number, it: Item): EditSelection => ({
  page,
  kind: it.kind,
  id: it.id,
  label: it.kind === "text" ? `Text: ${it.preview}` : "Image",
});

export function EditLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const wb = useWorkbench();
  const { state: im } = useInteractionManager(documentId);
  const active = im.activeMode === EDIT_MODE;
  const { register } = usePointerHandlers({ documentId, pageIndex, modeId: EDIT_MODE });
  const docState = useDocumentState(documentId);
  const doc = docState?.document;
  const scale = docState?.scale ?? 1;
  const [info, setInfo] = useState<EditPageInfo | null>(null);
  const [hover, setHover] = useState<Item | null>(null);
  const [drag, setDrag] = useState<{
    /** "text": Add Text; "image": placing a picked image. */
    kind: "text" | "image";
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  /** An image being moved, resized or rotated: where it is now (PDF points). */
  const [imgDrag, setImgDrag] = useState<{
    img: EditImage;
    handle: Handle;
    from: Pt;
    now: Placement;
  } | null>(null);
  const [ghost, setGhost] = useState<Pt | null>(null);
  /** A text box pressed but not yet released: a drag moves it, a click edits it. */
  const [press, setPress] = useState<{
    box: EditTextBox;
    from: Pt;
    dx: number;
    dy: number;
    moving: boolean;
  } | null>(null);
  /** One of the selected text box's frame handles being dragged: the frame now. */
  const [frameDrag, setFrameDrag] = useState<{ box: EditTextBox; edge: Edge; now: Rect } | null>(
    null,
  );
  const overflow = useOverflowNote(documentId);
  const pending = usePendingImage(documentId);
  const selection = useEditSelection(documentId);
  const session = useEditSession(documentId);
  const adding = useAddingText(documentId);
  const showBoxes = useShowBoxes();
  const shift = useNudge(documentId);
  useFramesVersion();
  const storeId = wb.meta[documentId]?.storeId;
  const frameFor = (b: EditTextBox) => frameSettings.get(storeId, pageIndex, b);
  const latest = useRef({
    info,
    busy: wb.busy,
    drag,
    imgDrag,
    press,
    frameDrag,
    selection,
    scale,
    wb,
  });
  useEffect(() => {
    latest.current = { info, busy: wb.busy, drag, imgDrag, press, frameDrag, selection, scale, wb };
  });

  useEffect(() => {
    if (!active || !doc) return;
    let live = true;
    void contentOf(wb, documentId, doc)
      .then((bytes) => (bytes ? pageOp("editPageInfo", bytes, pageIndex) : null))
      .then((i) => {
        if (!live) return;
        setInfo(i);
        if (i) pageInfos.set(documentId, pageIndex, i);
        // An edit just reloaded the tab: select the box it wrote.
        const sid = wb.meta[documentId]?.storeId;
        const again = reselect.take(sid);
        if (again && again.page !== pageIndex) reselect.set(sid, again);
        else if (i && again) {
          const hit = hitTest(i, again.x, again.y);
          if (hit) editSelection.set(documentId, selectionOf(pageIndex, hit));
          // The box keeps its frame settings (its key changes when it gets an id).
          if (hit?.kind === "text" && again.frame)
            frameSettings.set(sid, pageIndex, hit, again.frame);
          overflowNote.set(
            documentId,
            hit?.kind === "text" && again.overflow
              ? { page: pageIndex, id: hit.id, text: again.overflow }
              : null,
          );
        }
      })
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [active, doc, documentId, pageIndex, wb]);

  useEffect(() => {
    if (!active) return;
    // Pointer positions are page points from the top-left; the engine's are bottom-left.
    const at = (pos: { x: number; y: number }) => {
      const i = latest.current.info;
      return i ? hitTest(i, pos.x, i.height - pos.y) : null;
    };
    const pdf = (pos: { x: number; y: number }): Pt => ({
      x: pos.x,
      y: (latest.current.info?.height ?? 0) - pos.y,
    });
    /** Handle size and rotate-handle gap: fixed on screen, so in points they shrink with zoom. */
    const px = (n: number) => n / latest.current.scale;
    /** Corners keep proportions unless Shift (the other way round when unlocked). */
    const free = (shiftKey: boolean) => (editOptions.get().lockAspect ? shiftKey : !shiftKey);
    const sid = () => latest.current.wb.meta[documentId]?.storeId;
    return register({
      onPointerMove: (pos, evt) => {
        const d = latest.current.drag;
        const g = latest.current.imgDrag;
        const f = latest.current.frameDrag;
        const pr = latest.current.press;
        if (f) {
          const start = frameOf(f.box, frameSettings.get(sid(), pageIndex, f.box));
          setFrameDrag({ ...f, now: dragEdge(start, f.edge, pdf(pos)) });
        } else if (pr) {
          const p = pdf(pos);
          const dx = p.x - pr.from.x;
          const dy = p.y - pr.from.y;
          const moving = pr.moving || Math.hypot(dx, dy) * latest.current.scale >= DRAG_PX;
          setPress({ ...pr, dx, dy, moving });
        } else if (g)
          setImgDrag({
            ...g,
            now: dragPlacement(g.img.placement, g.handle, g.from, pdf(pos), free(evt.shiftKey)),
          });
        else if (d) setDrag({ ...d, x1: pos.x, y1: pos.y });
        else if (pendingImage.get(documentId)) setGhost(pdf(pos));
        else setHover(addText.get(documentId) ? null : at(pos));
      },
      onPointerLeave: () => {
        setHover(null);
        setGhost(null);
      },
      onPointerDown: (pos, evt) => {
        // A click on the page ends an open editor (the page keeps focus from moving, so
        // its blur does not fire). Nothing starts while an edit is running: the page is
        // about to reload.
        if (editSession.commit(documentId) || latest.current.busy) return;
        if (pendingImage.get(documentId) || addText.get(documentId)) {
          const kind = pendingImage.get(documentId) ? "image" : "text";
          setDrag({ kind, x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y });
          return;
        }
        const i = latest.current.info;
        const sel = latest.current.selection;
        // The selected text box's frame handles (corners and edge middles).
        const selBox =
          sel?.kind === "text" && sel.page === pageIndex && !sel.more?.length
            ? i?.boxes[sel.id]
            : null;
        if (selBox && i) {
          const frame = frameOf(selBox, frameSettings.get(sid(), pageIndex, selBox));
          const edge = edgeAt(frame, pdf(pos), px(HANDLE));
          if (edge) {
            evt.setPointerCapture?.();
            setFrameDrag({ box: selBox, edge, now: frame });
            return;
          }
        }
        // The selected image's handles come first (they reach outside the image).
        const selected =
          sel?.kind === "image" && sel.page === pageIndex ? (i?.images[sel.id] ?? null) : null;
        const handle = selected
          ? hitHandle(selected.placement, pdf(pos), px(HANDLE), px(ROTATE_GAP))
          : null;
        const hit = handle && selected ? selected : at(pos);
        if (!hit) return editSelection.set(documentId, null);
        // Ctrl / Shift + click picks several text boxes (for Join) without editing.
        if (hit.kind === "text" && (evt.ctrlKey || evt.metaKey || evt.shiftKey)) {
          const had =
            sel?.kind === "text" && sel.page === pageIndex ? [sel.id, ...(sel.more ?? [])] : [];
          const ids = had.includes(hit.id) ? had.filter((x) => x !== hit.id) : [...had, hit.id];
          const [first, ...more] = ids;
          const box = first === undefined ? undefined : i?.boxes[first];
          editSelection.set(
            documentId,
            box ? { ...selectionOf(pageIndex, box), ...(more.length ? { more } : {}) } : null,
          );
          return;
        }
        editSelection.set(documentId, selectionOf(pageIndex, hit));
        evt.setPointerCapture?.();
        // Text: a drag moves the box, a click (on release) opens the editor.
        if (hit.kind === "text")
          setPress({ box: hit, from: pdf(pos), dx: 0, dy: 0, moving: false });
        else setImgDrag({ img: hit, handle: handle ?? "move", from: pdf(pos), now: hit.placement });
      },
      onPointerUp: (pos, evt) => {
        const f = latest.current.frameDrag;
        if (f) {
          evt.releasePointerCapture?.();
          setFrameDrag(null);
          void applyFrame(latest.current.wb, documentId, pageIndex, f.box, f.now);
          return;
        }
        const pr = latest.current.press;
        if (pr) {
          evt.releasePointerCapture?.();
          setPress(null);
          if (pr.moving)
            void moveTextBox(latest.current.wb, documentId, pageIndex, pr.box, pr.dx, pr.dy);
          else editSession.open(documentId, { kind: "box", page: pageIndex, box: pr.box });
          return;
        }
        const g = latest.current.imgDrag;
        const i = latest.current.info;
        if (g) {
          evt.releasePointerCapture?.();
          setImgDrag(null);
          const now = dragPlacement(
            g.img.placement,
            g.handle,
            g.from,
            pdf(pos),
            free(evt.shiftKey),
          );
          const p = g.img.placement;
          const changed =
            Math.hypot(now.cx - p.cx, now.cy - p.cy) > 0.5 ||
            Math.abs(now.width - p.width) > 0.5 ||
            Math.abs(now.height - p.height) > 0.5 ||
            Math.abs(now.rotation - p.rotation) > 0.2;
          const label =
            g.handle === "move"
              ? "Move image"
              : g.handle === "rotate"
                ? "Rotate image"
                : "Resize image";
          if (changed)
            void placeImageEdit(latest.current.wb, documentId, pageIndex, g.img, now, label);
          return;
        }
        const d = latest.current.drag;
        if (!d || !i) return;
        setDrag(null);
        const dragged = Math.abs(pos.x - d.x0) >= DRAG ? Math.abs(pos.x - d.x0) : null;
        const picked = pendingImage.get(documentId);
        if (d.kind === "image" && picked) {
          pendingImage.set(documentId, null);
          setGhost(null);
          // Its natural size centred on the click, or the dragged width (proportions kept).
          const size = naturalSize(picked.px, i.width);
          const width = dragged ?? size.width;
          const height = (width * picked.px.height) / picked.px.width;
          const left = dragged !== null ? Math.min(d.x0, pos.x) : pos.x - width / 2;
          const top =
            dragged !== null ? i.height - Math.min(d.y0, pos.y) : i.height - pos.y + height / 2;
          void addImageEdit(latest.current.wb, documentId, pageIndex, picked.bytes, {
            cx: left + width / 2,
            cy: top - height / 2,
            width,
            height,
            rotation: 0,
          });
          return;
        }
        editSession.open(documentId, {
          kind: "new",
          page: pageIndex,
          x: Math.min(d.x0, pos.x),
          top: i.height - Math.min(d.y0, pos.y),
          width: dragged,
        });
      },
    });
  }, [active, register, documentId, pageIndex]);

  if (!active || !info) return null;
  const css = (r: Rect): React.CSSProperties => ({
    left: r.l * scale,
    top: (info.height - r.t) * scale,
    width: (r.r - r.l) * scale,
    height: (r.t - r.b) * scale,
  });
  const offset = (r: Rect, d: { dx: number; dy: number } | null): Rect =>
    d ? { l: r.l + d.dx, r: r.r + d.dx, b: r.b + d.dy, t: r.t + d.dy } : r;
  const picked = (it: Item) =>
    selection?.page === pageIndex &&
    selection.kind === it.kind &&
    (selection.id === it.id || (it.kind === "text" && !!selection.more?.includes(it.id)));
  const state = (it: Item) =>
    picked(it) ? " selected" : hover?.kind === it.kind && hover.id === it.id ? " hover" : "";
  const editingHere = session?.page === pageIndex ? session : null;
  const selectedImage =
    selection?.kind === "image" && selection.page === pageIndex ? info.images[selection.id] : null;
  const nudged =
    selectedImage && shift
      ? {
          ...selectedImage.placement,
          cx: selectedImage.placement.cx + shift.dx,
          cy: selectedImage.placement.cy + shift.dy,
        }
      : null;
  const framed = imgDrag?.now ?? nudged ?? selectedImage?.placement ?? null;
  // The frame handles are for one box at a time.
  const selectedBox =
    selection?.kind === "text" && selection.page === pageIndex && !selection.more?.length
      ? info.boxes[selection.id]
      : null;
  const selFrame = selectedBox
    ? (frameDrag?.now ?? offset(frameOf(selectedBox, frameFor(selectedBox)), shift))
    : null;
  const ghostSize = pending ? naturalSize(pending.px, info.width) : null;
  return (
    <div
      className={`edit-layer${adding ? " adding" : ""}${showBoxes ? "" : " hide-boxes"}`}
      data-testid="edit-layer"
    >
      {info.images.map((img) => (
        <div
          key={`i${img.id}`}
          className={`edit-item edit-image${state(img)}`}
          data-testid="edit-image"
          aria-hidden="true"
          style={css(img.rect)}
        />
      ))}
      {info.boxes.map((b) => {
        if (editingHere?.kind === "box" && editingHere.box.id === b.id) return null;
        const f = frameFor(b);
        const moved = press?.moving && press.box.id === b.id ? press : null;
        const rect = b === selectedBox && selFrame ? selFrame : offset(frameOf(b, f), moved);
        const clash = (overflow?.page === pageIndex && overflow.id === b.id) || overfull(b, f);
        const live = moved || (b === selectedBox && (frameDrag || shift));
        return (
          <div
            key={`t${b.id}`}
            className={`edit-item edit-box${state(b)}${clash ? " overflow" : ""}${
              live ? " dragging" : ""
            }`}
            data-testid="edit-box"
            data-text={b.preview}
            aria-hidden="true"
            style={css(rect)}
          />
        );
      })}
      {selectedBox && selFrame && !editingHere && !press?.moving && (
        <>
          {frameDrag && (
            <div
              className="edit-item edit-new"
              data-testid="edit-width-preview"
              aria-hidden="true"
              style={css(frameDrag.now)}
            />
          )}
          {EDGES.map((edge) => {
            const x = edge.includes("w")
              ? selFrame.l
              : edge.includes("e")
                ? selFrame.r
                : (selFrame.l + selFrame.r) / 2;
            const y = edge.includes("n")
              ? selFrame.t
              : edge.includes("s")
                ? selFrame.b
                : (selFrame.b + selFrame.t) / 2;
            return (
              <span
                key={edge}
                className={`edit-handle frame ${edge}`}
                data-testid={edge === "e" ? "edit-width-handle" : "edit-frame-handle"}
                data-edge={edge}
                aria-hidden="true"
                style={{ left: x * scale, top: (info.height - y) * scale }}
              />
            );
          })}
        </>
      )}
      {framed && (
        <div
          className={`edit-frame${imgDrag ? " dragging" : ""}`}
          data-testid="edit-image-frame"
          aria-hidden="true"
          style={{
            left: (framed.cx - framed.width / 2) * scale,
            top: (info.height - framed.cy - framed.height / 2) * scale,
            width: framed.width * scale,
            height: framed.height * scale,
            transform: `rotate(${-framed.rotation}deg)`,
          }}
        >
          {(["nw", "ne", "se", "sw"] as const).map((h) => (
            <span key={h} className={`edit-handle ${h}`} data-handle={h} />
          ))}
          <span className="edit-rotate-stem" style={{ height: ROTATE_GAP }} />
          <span className="edit-handle rotate" data-handle="rotate" style={{ top: -ROTATE_GAP }} />
        </div>
      )}
      {ghostSize && ghost && !drag && (
        <div
          className="edit-item edit-new"
          data-testid="edit-image-ghost"
          aria-hidden="true"
          style={{
            left: (ghost.x - ghostSize.width / 2) * scale,
            top: (info.height - ghost.y - ghostSize.height / 2) * scale,
            width: ghostSize.width * scale,
            height: ghostSize.height * scale,
          }}
        />
      )}
      {drag && (
        <div
          className="edit-item edit-new"
          aria-hidden="true"
          style={{
            left: Math.min(drag.x0, drag.x1) * scale,
            top: Math.min(drag.y0, drag.y1) * scale,
            width: Math.abs(drag.x1 - drag.x0) * scale,
            height: Math.max(12, Math.abs(drag.y1 - drag.y0)) * scale,
          }}
        />
      )}
      {editingHere && (
        <TextEditor
          key={editingHere.kind === "box" ? `box${editingHere.box.id}` : "new"}
          documentId={documentId}
          session={editingHere}
          pageHeight={info.height}
          scale={scale}
        />
      )}
    </div>
  );
}
