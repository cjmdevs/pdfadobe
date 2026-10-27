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
import type { EditImage, EditPageInfo, EditTextBox, Rect } from "../../engine/edit";
import { hitTest } from "../../engine/edit/pageInfo";
import { pageOp } from "../../app/pages";
import { useWorkbench, type WorkbenchApi } from "../../app/workbench";
import {
  EDIT_MODE,
  addText,
  editSelection,
  editSession,
  reselect,
  useAddingText,
  useEditSelection,
  useEditSession,
  type EditSelection,
} from "./editStore";
import { TextEditor } from "./TextEditor";

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
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const selection = useEditSelection(documentId);
  const session = useEditSession(documentId);
  const adding = useAddingText(documentId);
  const latest = useRef({ info, busy: wb.busy, drag });
  useEffect(() => {
    latest.current = { info, busy: wb.busy, drag };
  });

  useEffect(() => {
    if (!active || !doc) return;
    let live = true;
    void contentOf(wb, documentId, doc)
      .then((bytes) => (bytes ? pageOp("editPageInfo", bytes, pageIndex) : null))
      .then((i) => {
        if (!live) return;
        setInfo(i);
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
    return register({
      onPointerMove: (pos) => {
        const d = latest.current.drag;
        if (d) setDrag({ ...d, x1: pos.x, y1: pos.y });
        else setHover(addText.get(documentId) ? null : at(pos));
      },
      onPointerLeave: () => setHover(null),
      onPointerDown: (pos) => {
        // A click on the page ends an open editor (the page keeps focus from moving, so
        // its blur does not fire). Nothing starts while an edit is running: the page is
        // about to reload.
        if (editSession.commit(documentId) || latest.current.busy) return;
        if (addText.get(documentId)) {
          setDrag({ x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y });
          return;
        }
        const hit = at(pos);
        if (!hit) return editSelection.set(documentId, null);
        editSelection.set(documentId, selectionOf(pageIndex, hit));
        if (hit.kind === "text")
          editSession.open(documentId, { kind: "box", page: pageIndex, box: hit });
      },
      onPointerUp: (pos) => {
        const d = latest.current.drag;
        const i = latest.current.info;
        if (!d || !i) return;
        setDrag(null);
        const width = Math.abs(pos.x - d.x0) >= DRAG ? Math.abs(pos.x - d.x0) : null;
        editSession.open(documentId, {
          kind: "new",
          page: pageIndex,
          x: Math.min(d.x0, pos.x),
          top: i.height - Math.min(d.y0, pos.y),
          width,
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
