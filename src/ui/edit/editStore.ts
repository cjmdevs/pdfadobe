// Edit PDF (B3): which text box or image is selected, per document. Shared by the
// page layers, the Edit panel and the Escape command through this tiny store.
import { useSyncExternalStore } from "react";

/** Interaction mode while the Edit tool is on (EditLayer handles the pointer). */
export const EDIT_MODE = "editPdf";

export interface EditSelection {
  page: number;
  kind: "text" | "image";
  /** Id from editPageInfo for the current bytes. */
  id: number;
  /** Accessible description ("text: Two invoices dated…", "image"). */
  label: string;
}

const selections = new Map<string, EditSelection | null>();
const listeners = new Set<() => void>();

export const editSelection = {
  get: (documentId: string) => selections.get(documentId) ?? null,
  set(documentId: string, sel: EditSelection | null) {
    if (selections.get(documentId) === sel) return;
    selections.set(documentId, sel);
    for (const l of listeners) l();
  },
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useEditSelection(documentId: string): EditSelection | null {
  return useSyncExternalStore(subscribe, () => editSelection.get(documentId));
}
