// Edit PDF (B3): edits started from the page, the panel and the keyboard. Each one runs
// in the page worker through Workbench.edit (one undo step) and selects the result
// again once the tab has reloaded.
import type { EditImage, EditTextBox, Placement, Rect, RetypesetResult } from "../../engine/edit";
import { imageFileSize } from "../../engine/edit/images";
import { pageOp } from "../../app/pages";
import type { WorkbenchApi } from "../../app/workbench";
import { platform } from "../../platform";
import type { AlignHow, AlignItem, ImageEdit } from "../../engine/edit";
import type { Arrange } from "../../engine/edit/arrange";
import type { LinkSpec } from "../../engine/edit/links";
import type { ExternalApp } from "../../platform/types";
import {
  editOptions,
  externalEdits,
  frameSettings,
  type ExternalEditing,
  type LinkEditing,
  linkMode,
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
  if (r?.offPage) return "the edge of the page";
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
  if (r?.offPage)
    wb.toast(
      "The text now runs past the edge of the page. Shorten it, resize the box, or undo.",
      "error",
    );
  else if (r?.pushedOff)
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

/** An image edit from the Objects panel (one undo step); the image is selected again. */
export function imageEdit(
  wb: WorkbenchApi,
  documentId: string,
  page: number,
  img: EditImage,
  op: ImageEdit,
  label: string,
) {
  return wb.edit(
    documentId,
    label,
    async (bytes) => {
      const out = await pageOp("editImage", bytes, imageRef(page, img), op);
      selectAfter(wb, documentId, page, img.placement.cx, img.placement.cy);
      return out;
    },
    { page },
  );
}

/** A text box forward / backward / to the front / to the back. */
export function arrangeTextBox(
  wb: WorkbenchApi,
  documentId: string,
  page: number,
  box: EditTextBox,
  how: Arrange,
) {
  const t = textRectOf(box);
  return wb.edit(
    documentId,
    "Arrange",
    async (bytes) => {
      const out = await pageOp("arrangeText", bytes, boxRef(page, box), how);
      selectAfter(wb, documentId, page, (t.l + t.r) / 2, t.t - Math.min(4, (t.t - t.b) / 2));
      return out;
    },
    { page },
  );
}

/** Aligns the selected boxes and images with each other (one undo step). */
export function alignSelection(
  wb: WorkbenchApi,
  documentId: string,
  sel: EditSelection,
  how: AlignHow,
) {
  const info = pageInfos.get(documentId, sel.page);
  if (!info) return Promise.resolve(false);
  const texts = sel.kind === "text" ? [sel.id, ...(sel.more ?? [])] : (sel.more ?? []);
  const imgs = sel.kind === "image" ? [sel.id, ...(sel.images ?? [])] : (sel.images ?? []);
  const items: AlignItem[] = [
    ...texts.flatMap((id) => {
      const b = info.boxes[id];
      return b ? [{ kind: "text" as const, ref: boxRef(sel.page, b) }] : [];
    }),
    ...imgs.flatMap((id) => {
      const i = info.images[id];
      return i ? [{ kind: "image" as const, ref: imageRef(sel.page, i) }] : [];
    }),
  ];
  if (items.length < 2) return Promise.resolve(false);
  return wb.edit(
    documentId,
    "Align objects",
    (bytes) => pageOp("alignObjects", bytes, sel.page, items, how),
    { page: sel.page },
  );
}

/** How often Edit Using looks for the other program's save (ms). */
const WATCH_EVERY = 1000;

/**
 * Edit Using: opens the image in another program and puts each version it saves into
 * the PDF (one undo step each), until stopped or the document closes. It follows the
 * document by its store id: the tab's id changes with every edit.
 */
export async function editUsing(
  wb: WorkbenchApi,
  documentId: string,
  page: number,
  img: EditImage,
  app: ExternalApp,
) {
  const storeId = wb.meta[documentId]?.storeId;
  const bytes = await wb.contentBytes(documentId);
  if (!storeId || !bytes) return;
  let file: { data: Uint8Array; ext: "jpg" | "png" };
  let id: number;
  try {
    file = await pageOp("exportImage", bytes, imageRef(page, img));
    id = await platform.externalEdit.start(file.data, file.ext, app);
  } catch (e) {
    wb.toast(e instanceof Error ? e.message : String(e), "error");
    return;
  }
  const entry = { id, app, page, cx: img.placement.cx, cy: img.placement.cy };
  externalEdits.set(storeId, [...externalEdits.get(storeId), entry]);
  const watch = async () => {
    const still = externalEdits.get(storeId).find((e) => e.id === id);
    const doc = wb.documentOf(storeId);
    // Stopped, or the document closed: stop watching.
    if (!still || !doc) {
      await stopEditUsing(storeId, id);
      return;
    }
    try {
      const data = await platform.externalEdit.poll(id);
      if (data) await putBack(wb, doc, storeId, still, data);
    } catch {
      await stopEditUsing(storeId, id);
      return;
    }
    window.setTimeout(() => void watch(), WATCH_EVERY);
  };
  window.setTimeout(() => void watch(), WATCH_EVERY);
}

/** Puts the other program's saved picture in place of the image at the entry's centre. */
async function putBack(
  wb: WorkbenchApi,
  documentId: string,
  storeId: string,
  e: ExternalEditing,
  data: Uint8Array,
) {
  const info = pageInfos.get(documentId, e.page);
  const img = info?.images.find(
    (i) => Math.hypot(i.placement.cx - e.cx, i.placement.cy - e.cy) < 1,
  );
  if (!img) {
    wb.toast("The image edited in the other program is no longer on the page.", "error");
    await stopEditUsing(storeId, e.id);
    return;
  }
  await wb.edit(
    documentId,
    "Edit image",
    async (bytes) => {
      const out = await pageOp("editImage", bytes, imageRef(e.page, img), {
        kind: "replace",
        data,
      });
      selectAfter(wb, documentId, e.page, e.cx, e.cy);
      return out;
    },
    { page: e.page },
  );
}

export async function stopEditUsing(storeId: string, id: number) {
  externalEdits.set(
    storeId,
    externalEdits.get(storeId).filter((e) => e.id !== id),
  );
  await platform.externalEdit.end(id).catch(() => undefined);
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

/**
 * A link edit (one undo step). The tab's id changes with the edit: the Link tool stays
 * on for the tab it reopens as.
 */
async function linkEdit(
  wb: WorkbenchApi,
  documentId: string,
  label: string,
  fn: (bytes: Uint8Array) => Promise<Uint8Array>,
  page?: number,
) {
  const storeId = wb.meta[documentId]?.storeId;
  const wasOn = linkMode.on(documentId);
  const ok = await wb.edit(documentId, label, fn, page === undefined ? undefined : { page });
  const now = storeId ? wb.documentOf(storeId) : null;
  if (ok && wasOn && now && now !== documentId) {
    linkMode.set(documentId, false);
    linkMode.set(now, true);
  }
  return ok;
}

/** Saves the link in the panel (new or changed): one undo step. */
export function saveLink(
  wb: WorkbenchApi,
  documentId: string,
  link: LinkEditing,
  spec: Omit<LinkSpec, "rect">,
) {
  return linkEdit(
    wb,
    documentId,
    link.ref ? "Edit link" : "Add link",
    (bytes) => pageOp("setLink", bytes, link.page, { ...spec, rect: link.rect }, link.ref),
    link.page,
  );
}

export function removeLink(wb: WorkbenchApi, documentId: string, page: number, ref: string) {
  return linkEdit(
    wb,
    documentId,
    "Remove link",
    (bytes) => pageOp("removeLinks", bytes, page, [ref]),
    page,
  );
}

/** Removes every web link in the document (one undo step), and says how many. */
export async function removeAllWebLinks(wb: WorkbenchApi, documentId: string) {
  let removed = 0;
  const ok = await linkEdit(wb, documentId, "Remove web links", async (bytes) => {
    const r = await pageOp("removeWebLinks", bytes);
    removed = r.removed;
    return r.bytes;
  });
  if (ok)
    wb.toast(
      removed
        ? `Removed ${removed} web link${removed === 1 ? "" : "s"}.`
        : "This document has no web links.",
    );
  return ok;
}
