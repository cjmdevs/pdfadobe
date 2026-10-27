// Edit PDF (B3): outlines around the page's text boxes and images while Edit mode is on,
// like Acrobat's Edit PDF. A click on text opens the in-place editor; a click on an
// image selects it; a click on empty page clears the selection. In Add Text mode a
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
  pendingImage,
  useEditSelection,
  useEditSession,
  usePendingImage,
  type EditSelection,
} from "./editStore";
import { TextEditor } from "./TextEditor";
import { dragPlacement, hitHandle, naturalSize, type Handle, type Pt } from "./imageDrag";
import { addImageEdit, placeImageEdit } from "./editActions";

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
  const pending = usePendingImage(documentId);
  const selection = useEditSelection(documentId);
  const session = useEditSession(documentId);
  const adding = useAddingText(documentId);
  const latest = useRef({ info, busy: wb.busy, drag, imgDrag, selection, scale, wb });
  useEffect(() => {
    latest.current = { info, busy: wb.busy, drag, imgDrag, selection, scale, wb };
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
    return register({
      onPointerMove: (pos, evt) => {
        const d = latest.current.drag;
        const g = latest.current.imgDrag;
        if (g)
          setImgDrag({
            ...g,
            now: dragPlacement(g.img.placement, g.handle, g.from, pdf(pos), evt.shiftKey),
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
        // The selected image's handles come first (they reach outside the image).
        const selected =
          sel?.kind === "image" && sel.page === pageIndex ? (i?.images[sel.id] ?? null) : null;
        const handle = selected
          ? hitHandle(selected.placement, pdf(pos), px(HANDLE), px(ROTATE_GAP))
          : null;
        const hit = handle && selected ? selected : at(pos);
        if (!hit) return editSelection.set(documentId, null);
        editSelection.set(documentId, selectionOf(pageIndex, hit));
        if (hit.kind === "text")
          editSession.open(documentId, { kind: "box", page: pageIndex, box: hit });
        else {
          evt.setPointerCapture?.();
          setImgDrag({ img: hit, handle: handle ?? "move", from: pdf(pos), now: hit.placement });
        }
      },
      onPointerUp: (pos, evt) => {
        const g = latest.current.imgDrag;
        const i = latest.current.info;
        if (g) {
          evt.releasePointerCapture?.();
          setImgDrag(null);
          const now = dragPlacement(g.img.placement, g.handle, g.from, pdf(pos), evt.shiftKey);
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
  const state = (it: Item) =>
    selection?.page === pageIndex && selection.kind === it.kind && selection.id === it.id
      ? " selected"
      : hover?.kind === it.kind && hover.id === it.id
        ? " hover"
        : "";
  const editingHere = session?.page === pageIndex ? session : null;
  const selectedImage =
    selection?.kind === "image" && selection.page === pageIndex ? info.images[selection.id] : null;
  const framed = imgDrag?.now ?? selectedImage?.placement ?? null;
  const ghostSize = pending ? naturalSize(pending.px, info.width) : null;
  return (
    <div className={`edit-layer${adding ? " adding" : ""}`} data-testid="edit-layer">
      {info.images.map((img) => (
        <div
          key={`i${img.id}`}
          className={`edit-item edit-image${state(img)}`}
          data-testid="edit-image"
          aria-hidden="true"
          style={css(img.rect)}
        />
      ))}
      {info.boxes.map((b) =>
        editingHere?.kind === "box" && editingHere.box.id === b.id ? null : (
          <div
            key={`t${b.id}`}
            className={`edit-item edit-box${state(b)}`}
            data-testid="edit-box"
            data-text={b.preview}
            aria-hidden="true"
            style={css(b.rect)}
          />
        ),
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
