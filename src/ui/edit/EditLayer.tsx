// Edit PDF (B3): outlines around the page's text boxes and images while Edit mode is on,
// like Acrobat's Edit PDF. Hover highlights, a click selects (the Edit panel shows the
// selection), a click on empty page clears it. The boxes come from the engine
// (editPageInfo) in the page worker, read from the store's current bytes.
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
import { EDIT_MODE, editSelection, useEditSelection } from "./editStore";

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
  const selection = useEditSelection(documentId);
  const latest = useRef(info);
  useEffect(() => {
    latest.current = info;
  });

  useEffect(() => {
    if (!active || !doc) return;
    let live = true;
    void contentOf(wb, documentId, doc)
      .then((bytes) => (bytes ? pageOp("editPageInfo", bytes, pageIndex) : null))
      .then((i) => live && setInfo(i))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [active, doc, documentId, pageIndex, wb]);

  useEffect(() => {
    if (!active) return;
    // Pointer positions are page points from the top-left; the engine's are bottom-left.
    const at = (pos: { x: number; y: number }) => {
      const i = latest.current;
      return i ? hitTest(i, pos.x, i.height - pos.y) : null;
    };
    return register({
      onPointerMove: (pos) => setHover(at(pos)),
      onPointerLeave: () => setHover(null),
      onPointerDown: (pos) => {
        const hit = at(pos);
        editSelection.set(
          documentId,
          hit
            ? {
                page: pageIndex,
                kind: hit.kind,
                id: hit.id,
                label: hit.kind === "text" ? `Text: ${hit.preview}` : "Image",
              }
            : null,
        );
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
  return (
    <div className="edit-layer" data-testid="edit-layer" aria-hidden="true">
      {info.images.map((img) => (
        <div
          key={`i${img.id}`}
          className={`edit-item edit-image${state(img)}`}
          data-testid="edit-image"
          style={css(img.rect)}
        />
      ))}
      {info.boxes.map((b) => (
        <div
          key={`t${b.id}`}
          className={`edit-item edit-box${state(b)}`}
          data-testid="edit-box"
          data-text={b.preview}
          style={css(b.rect)}
        />
      ))}
    </div>
  );
}
