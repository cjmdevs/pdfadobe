// Edit PDF (B3): edits started from the page, the panel and the keyboard. Each one runs
// in the page worker through Workbench.edit (one undo step) and selects the result
// again once the tab has reloaded.
import type { EditImage, EditTextBox, Placement, Rect, RetypesetResult } from "../../engine/edit";
import { imageFileSize } from "../../engine/edit/images";
import { pageOp } from "../../app/pages";
import type { WorkbenchApi } from "../../app/workbench";
import { platform } from "../../platform";
import {
  editOptions,
  frameSettings,
  pageInfos,
  pendingImage,
  reselect,
  type EditSelection,
  type FrameSettings,
} from "./editStore";
import { frameChange, textRectOf } from "./frame";

const imageRef = (page: number, img: EditImage) => ({ page, id: img.id, rect: img.rect });

/** What the edit ran into, in words, or null. */
export function overflowText(r: RetypesetResult | null): string | null {
  if (!r?.overflow.length) return null;
  const hit = r.overflow.find((o) => o.kind === "text");
  return hit ? `the text "${hit.text}"` : "a line on the page";
}

/** Options every text edit passes: push the column below down (the panel's choice). */
export const textEditOpts = () => ({ push: editOptions.get().push });

/**
 * After a text edit, before the tab reloads: select the box again (keeping its frame
 * settings), and remember what it runs into so the panel can say so. Returns that, or
 * null.
 */
export function afterTextEdit(
  wb: WorkbenchApi,
  documentId: string,
  page: number,
  r: RetypesetResult | null,
  frame?: FrameSettings,
): string | null {
  const first = r?.lines[0];
  const hit = overflowText(r);
  if (first)
    reselect.set(wb.meta[documentId]?.storeId, {
      page,
      x: (first.l + first.r) / 2,
      y: (first.b + first.t) / 2,
      ...(hit ? { overflow: hit } : {}),
      ...(frame ? { frame } : {}),
    });
  return hit;
}

/** Toasts after an edit: what it runs into, or what was pushed down. */
export function reportTextEdit(wb: WorkbenchApi, r: RetypesetResult | null, hit: string | null) {
  if (r?.pushedOff)
    wb.toast(
      `${r.pushedOff} pushed text box${r.pushedOff > 1 ? "es now run" : " now runs"} past the bottom of the page.`,
      "error",
    );
  else if (hit)
    wb.toast(
      `The text now runs into ${hit}. Drag the box's edges to change its size, turn on "Push text below down", or undo.`,
    );
}

const boxRef = (page: number, b: EditTextBox) => ({ page, id: b.id, preview: b.preview });

/** Moves a text box as it is (drag, arrow keys, X/Y fields): one undo step. */
export function moveTextBox(
  wb: WorkbenchApi,
  documentId: string,
  page: number,
  box: EditTextBox,
  dx: number,
  dy: number,
) {
  const storeId = wb.meta[documentId]?.storeId;
  const frame = frameSettings.get(storeId, page, box);
  return wb.edit(
    documentId,
    "Move text box",
    async (bytes) => {
      const out = await pageOp("moveText", bytes, boxRef(page, box), dx, dy);
      const t = textRectOf(box);
      reselect.set(storeId, {
        page,
        x: (t.l + t.r) / 2 + dx,
        y: t.t - Math.min(4, (t.t - t.b) / 2) + dy,
        frame,
      });
      return out;
    },
    { page },
  );
}

/**
 * Gives a text box the frame `next` (handles, X/Y/W/H fields): a new width re-wraps it,
 * a move moves it, a new height turns auto-fit off. One undo step.
 */
export async function applyFrame(
  wb: WorkbenchApi,
  documentId: string,
  page: number,
  box: EditTextBox,
  next: Rect,
) {
  const storeId = wb.meta[documentId]?.storeId;
  const f = frameSettings.get(storeId, page, box);
  const c = frameChange(box, f, next);
  const frame: FrameSettings =
    c.height !== undefined ? { ...f, autoFit: false, height: c.height } : f;
  if (c.height !== undefined) frameSettings.set(storeId, page, box, frame);
  if (!c.rewrap && c.dx === undefined && c.dy === undefined) return true;
  if (!c.rewrap) return moveTextBox(wb, documentId, page, box, c.dx ?? 0, c.dy ?? 0);
  const rewrap = c.rewrap;
  let result: RetypesetResult | null = null;
  let hit: string | null = null;
  const ok = await wb.edit(
    documentId,
    "Resize text box",
    async (bytes) => {
      const r = await pageOp(
        "editText",
        bytes,
        boxRef(page, box),
        box.paragraphs,
        [],
        rewrap.width,
        { left: rewrap.left, ...(c.dy ? { dy: c.dy } : {}), ...textEditOpts() },
      );
      result = r.result;
      hit = afterTextEdit(wb, documentId, page, r.result, frame);
      return r.bytes;
    },
    { page },
  );
  if (ok) reportTextEdit(wb, result, hit);
  return ok;
}

/** Joins the selected text boxes (Ctrl+click) into one paragraph: one undo step. */
export async function joinSelection(wb: WorkbenchApi, documentId: string, sel: EditSelection) {
  const info = pageInfos.get(documentId, sel.page);
  const boxes = [sel.id, ...(sel.more ?? [])].flatMap((id) => {
    const b = info?.boxes[id];
    return b ? [b] : [];
  });
  if (sel.kind !== "text" || boxes.length < 2) return false;
  let hit: string | null = null;
  const ok = await wb.edit(
    documentId,
    "Join text boxes",
    async (bytes) => {
      const r = await pageOp(
        "joinText",
        bytes,
        boxes.map((b) => ({ page: sel.page, id: b.id, preview: b.preview })),
      );
      hit = afterTextEdit(wb, documentId, sel.page, r.result);
      return r.bytes;
    },
    { page: sel.page },
  );
  if (ok && hit) wb.toast(`The joined text runs into ${hit as string}.`);
  return ok;
}

function selectAfter(wb: WorkbenchApi, documentId: string, page: number, x: number, y: number) {
  reselect.set(wb.meta[documentId]?.storeId, { page, x, y });
}

export function placeImageEdit(
  wb: WorkbenchApi,
  documentId: string,
  page: number,
  img: EditImage,
  placement: Placement,
  label: "Move image" | "Resize image" | "Rotate image",
) {
  return wb.edit(
    documentId,
    label,
    async (bytes) => {
      const out = await pageOp("editImage", bytes, imageRef(page, img), {
        kind: "place",
        placement,
      });
      selectAfter(wb, documentId, page, placement.cx, placement.cy);
      return out;
    },
    { page },
  );
}

/** Picks a JPEG or PNG and puts it in place of the image (same box, its own proportions). */
export async function replaceImageEdit(
  wb: WorkbenchApi,
  documentId: string,
  page: number,
  img: EditImage,
) {
  const [file] = await platform.pickFiles({ pictures: true });
  if (!file) return false;
  const data = new Uint8Array(file.bytes);
  return wb.edit(
    documentId,
    "Replace image",
    async (bytes) => {
      const out = await pageOp("editImage", bytes, imageRef(page, img), { kind: "replace", data });
      selectAfter(wb, documentId, page, img.placement.cx, img.placement.cy);
      return out;
    },
    { page },
  );
}

/** Picks a JPEG or PNG for Add Image; the next click (or drag) on a page places it. */
export async function pickImageToAdd(wb: WorkbenchApi, documentId: string) {
  const [file] = await platform.pickFiles({ pictures: true });
  if (!file) return;
  const bytes = new Uint8Array(file.bytes);
  try {
    pendingImage.set(documentId, { bytes, px: imageFileSize(bytes), name: file.name });
  } catch (e) {
    wb.toast(e instanceof Error ? e.message : String(e), "error");
  }
}

export function addImageEdit(
  wb: WorkbenchApi,
  documentId: string,
  page: number,
  data: Uint8Array,
  placement: Placement,
) {
  return wb.edit(
    documentId,
    "Add image",
    async (bytes) => {
      const out = await pageOp("addImage", bytes, page, data, placement);
      selectAfter(wb, documentId, page, placement.cx, placement.cy);
      return out;
    },
    { page },
  );
}

/** Deletes the selected image, or the selected text box's text. */
export function deleteSelection(wb: WorkbenchApi, documentId: string, sel: EditSelection) {
  const info = pageInfos.get(documentId, sel.page);
  if (!info) return Promise.resolve(false);
  if (sel.kind === "image") {
    const img = info.images[sel.id];
    if (!img) return Promise.resolve(false);
    return wb.edit(
      documentId,
      "Delete image",
      (bytes) => pageOp("editImage", bytes, imageRef(sel.page, img), { kind: "delete" }),
      { page: sel.page },
    );
  }
  const box: EditTextBox | undefined = info.boxes[sel.id];
  if (!box) return Promise.resolve(false);
  return wb.edit(
    documentId,
    "Delete text",
    async (bytes) =>
      (
        await pageOp(
          "editText",
          bytes,
          { page: sel.page, id: box.id, preview: box.preview },
          box.paragraphs.map(() => ""),
        )
      ).bytes,
    { page: sel.page },
  );
}
