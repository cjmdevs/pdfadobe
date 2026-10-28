// Reset form and Clear fields (Phase 6) as the UI runs them: one undoable step each,
// through the page-engine worker. Field values never go to a toast or the log.
import type { WorkbenchApi } from "../../app/workbench";
import { pageOp } from "../../app/pages";
import type { ResetRequest } from "../../engine/forms";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

async function run(wb: WorkbenchApi, documentId: string, label: string, req: ResetRequest) {
  let changed = 0;
  let readOnly = 0;
  const ok = await wb.edit(documentId, label, async (bytes) => {
    const r = await pageOp("resetFields", bytes, req);
    changed = r.changed.length;
    readOnly = r.readOnly.length;
    return r.bytes;
  });
  if (!ok) return;
  const skipped = readOnly ? ` ${plural(readOnly, "read-only field")} left as they are.` : "";
  wb.toast(`${label}: ${plural(changed, "field")} changed.${skipped} Ctrl+Z undoes it.`);
}

/** Every field back to its default value (Acrobat "Reset Form"). Asks first. */
export async function resetForm(wb: WorkbenchApi, documentId: string): Promise<void> {
  const yes = await wb.confirm({
    title: "Reset form",
    message:
      "Put every field back to its default value? What was typed is removed. " +
      "You can undo this (Ctrl+Z).",
    ok: "Reset",
    danger: true,
  });
  if (yes) await run(wb, documentId, "Reset form", { to: "default" });
}

/** Empties the named fields (no default value applied). */
export async function clearFields(
  wb: WorkbenchApi,
  documentId: string,
  names: string[],
): Promise<void> {
  if (!names.length) return;
  await run(wb, documentId, `Clear ${plural(names.length, "field")}`, { to: "empty", names });
}
