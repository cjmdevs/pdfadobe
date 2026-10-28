// Prepare Form commands (Phase 6): add a field, set the properties only the engine can
// write. Each is one undoable step through the page-engine worker.
import type { WorkbenchApi } from "../../app/workbench";
import { pageOp } from "../../app/pages";
import type { FieldProps, NewFieldKind, PdfRect } from "../../engine/forms";
import { prepare } from "./prepareStore";

const LABEL: Record<NewFieldKind, string> = {
  text: "text field",
  checkbox: "check box",
  radio: "radio button",
  dropdown: "dropdown",
  date: "date field",
  signature: "signature field",
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function placeField(
  wb: WorkbenchApi,
  documentId: string,
  kind: NewFieldKind,
  pageIndex: number,
  rect: PdfRect,
): Promise<void> {
  // Keyed by the store id: the tab's document id changes with every edit.
  const key = wb.meta[documentId]?.storeId ?? documentId;
  const group = kind === "radio" ? prepare.radioGroup(key) : "";
  let name = "";
  try {
    const ok = await wb.edit(
      documentId,
      `Add ${LABEL[kind]}`,
      async (bytes) => {
        const r = await pageOp("addField", bytes, {
          kind,
          pageIndex,
          rect,
          ...(group ? { joinGroup: group } : {}),
        });
        name = r.name;
        return r.bytes;
      },
      { page: pageIndex },
    );
    if (!ok) return;
    // The next radio button joins the group this one made (Acrobat's "add another").
    if (kind === "radio" && !group) prepare.setRadioGroup(key, name);
    wb.toast(`Added ${LABEL[kind]} "${name}". Drag it to move, drag its corners to resize.`);
  } catch (e) {
    wb.toast(`Could not add the field: ${message(e)}`, "error");
  }
}

export async function applyFieldProps(
  wb: WorkbenchApi,
  documentId: string,
  name: string,
  props: Partial<FieldProps>,
): Promise<boolean> {
  try {
    return await wb.edit(documentId, `Field properties (${name})`, (bytes) =>
      pageOp("setFieldProps", bytes, name, props),
    );
  } catch (e) {
    wb.toast(`Could not change the field: ${message(e)}`, "error");
    return false;
  }
}

export async function loadFieldProps(
  wb: WorkbenchApi,
  documentId: string,
  name: string,
): Promise<FieldProps | null> {
  const bytes = await wb.docBytes(documentId);
  if (!bytes) return null;
  try {
    return await pageOp("readFieldProps", bytes, name);
  } catch {
    return null;
  }
}
