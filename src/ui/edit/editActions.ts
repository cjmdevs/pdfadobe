// Edit PDF (B3): edits started from the page, the panel and the keyboard. Each one runs
// in the page worker through Workbench.edit (one undo step) and selects the result
// again once the tab has reloaded.
import type { EditImage, EditTextBox, Placement, RetypesetResult } from "../../engine/edit";
import { imageFileSize } from "../../engine/edit/images";
import { pageOp } from "../../app/pages";
import type { WorkbenchApi } from "../../app/workbench";
import { platform } from "../../platform";
import { pageInfos, pendingImage, reselect, type EditSelection } from "./editStore";

const imageRef = (page: number, img: EditImage) => ({ page, id: img.id, rect: img.rect });

/** What the edit ran into, in words, or null. */
export function overflowText(r: RetypesetResult | null): string | null {
  if (!r?.overflow.length) return null;
  const hit = r.overflow.find((o) => o.kind === "text");
  return hit ? `the text "${hit.text}"` : "a line on the page";
}

/**
 * After a text edit, before the tab reloads: select the box again, and remember what it
 * runs into so the panel can say so. Returns that, or null.
 */
export function afterTextEdit(
  wb: WorkbenchApi,
  documentId: string,
  page: number,
  r: RetypesetResult | null,
): string | null {
  const first = r?.lines[0];
  const hit = overflowText(r);
  if (first)
    reselect.set(wb.meta[documentId]?.storeId, {
      page,
      x: (first.l + first.r) / 2,
      y: (first.b + first.t) / 2,
      ...(hit ? { overflow: hit } : {}),
    });
  return hit;
}

/** The right-edge handle: re-wraps the box's text at `width` points (one undo step). */
export async function resizeTextBox(
  wb: WorkbenchApi,
  documentId: string,
  page: number,
  box: EditTextBox,
  width: number,
) {
  let hit: string | null = null;
  const ok = await wb.edit(
    documentId,
    "Resize text box",
    async (bytes) => {
      const r = await pageOp(
        "editText",
        bytes,
        { page, id: box.id, preview: box.preview },
        box.paragraphs,
        [],
        width,
      );
      hit = afterTextEdit(wb, documentId, page, r.result);
      return r.bytes;
    },
    { page },
  );
  if (ok && hit) wb.toast(`The text still runs into ${hit as string}.`);
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
