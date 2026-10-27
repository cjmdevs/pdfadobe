// Edit PDF (B3): per-document UI state shared by the page layers, the Edit panel, the
// toolbar and the Escape command: the selection, the open text editor, Add Text mode,
// and where to select again once an edited tab has reloaded.
import { useSyncExternalStore } from "react";
import type { EditTextBox } from "../../engine/edit";

/** Interaction mode while the Edit tool is on (EditLayer handles the pointer). */
export const EDIT_MODE = "editPdf";

export interface EditSelection {
  page: number;
  kind: "text" | "image";
  /** Id from editPageInfo for the current bytes. */
  id: number;
  /** Accessible description ("Text: Two invoices dated…", "Image"). */
  label: string;
}

/** The in-place editor: an existing box, or new text placed with Add Text. */
export type EditSession =
  | { kind: "box"; page: number; box: EditTextBox }
  | {
      kind: "new";
      page: number;
      /** Top-left of the new text and its width (null: one growing line), PDF points. */
      x: number;
      top: number;
      width: number | null;
    };

interface DocEditState {
  selection: EditSelection | null;
  session: EditSession | null;
  adding: boolean;
}

const EMPTY: DocEditState = { selection: null, session: null, adding: false };
const states = new Map<string, DocEditState>();
const listeners = new Set<() => void>();

function get(documentId: string): DocEditState {
  return states.get(documentId) ?? EMPTY;
}

function patch(documentId: string, p: Partial<DocEditState>) {
  const old = get(documentId);
  if (Object.entries(p).every(([k, v]) => old[k as keyof DocEditState] === v)) return;
  states.set(documentId, { ...old, ...p });
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const editSelection = {
  get: (documentId: string) => get(documentId).selection,
  set: (documentId: string, selection: EditSelection | null) => patch(documentId, { selection }),
};

/**
 * Commits the open editor (registered by the editor while it is open). Escape, a click
 * elsewhere and the tool closing all call this.
 */
const committers = new Map<string, () => void>();

export const editSession = {
  get: (documentId: string) => get(documentId).session,
  open: (documentId: string, session: EditSession) => patch(documentId, { session, adding: false }),
  close: (documentId: string) => patch(documentId, { session: null }),
  registerCommit(documentId: string, fn: (() => void) | null) {
    if (fn) committers.set(documentId, fn);
    else committers.delete(documentId);
  },
  /** Commits the open editor, if any. True when there was one. */
  commit(documentId: string): boolean {
    const fn = committers.get(documentId);
    if (!fn) return false;
    fn();
    return true;
  },
};

export const addText = {
  get: (documentId: string) => get(documentId).adding,
  set: (documentId: string, adding: boolean) =>
    patch(documentId, adding ? { adding, selection: null } : { adding }),
};

/**
 * After an edit the tab reopens under a new document id, so where to select again is
 * kept per store document (the same across revisions).
 */
type Reselect = { page: number; x: number; y: number };
const reselects = new Map<string, Reselect>();
export const reselect = {
  take(storeId: string | undefined): Reselect | null {
    if (!storeId) return null;
    const r = reselects.get(storeId) ?? null;
    reselects.delete(storeId);
    return r;
  },
  set(storeId: string | undefined, at: Reselect | null) {
    if (!storeId) return;
    if (at) reselects.set(storeId, at);
    else reselects.delete(storeId);
  },
};

/** Leaving Edit mode: nothing stays selected, open or armed. */
export function resetEdit(documentId: string) {
  patch(documentId, { selection: null, session: null, adding: false });
}

export function useEditSelection(documentId: string): EditSelection | null {
  return useSyncExternalStore(subscribe, () => get(documentId).selection);
}

export function useEditSession(documentId: string): EditSession | null {
  return useSyncExternalStore(subscribe, () => get(documentId).session);
}

export function useAddingText(documentId: string): boolean {
  return useSyncExternalStore(subscribe, () => get(documentId).adding);
}
