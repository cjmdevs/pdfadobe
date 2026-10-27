// Edit PDF (B3): per-document UI state shared by the page layers, the Edit panel, the
// toolbar and the Escape command: the selection, the open text editor, Add Text mode,
// and where to select again once an edited tab has reloaded.
import { useSyncExternalStore } from "react";
import type { EditPageInfo, EditTextBox, PlainStyle } from "../../engine/edit";

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
  /** Style picked in the panel while the editor is open (applied when it commits). */
  sessionStyle: Partial<PlainStyle> | null;
  /** The font picker's choice for that style ("section:family"). */
  sessionFontKey: string | null;
  /** editPageInfo per page, as the layers last read it. */
  pages: ReadonlyMap<number, EditPageInfo>;
}

const EMPTY: DocEditState = {
  selection: null,
  session: null,
  adding: false,
  sessionStyle: null,
  sessionFontKey: null,
  pages: new Map(),
};
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
  open: (documentId: string, session: EditSession) =>
    patch(documentId, { session, adding: false, sessionStyle: null, sessionFontKey: null }),
  close: (documentId: string) =>
    patch(documentId, { session: null, sessionStyle: null, sessionFontKey: null }),
  style: (documentId: string) => get(documentId).sessionStyle,
  setStyle(documentId: string, style: Partial<PlainStyle>, fontKey: string | null) {
    const old = get(documentId);
    patch(documentId, {
      sessionStyle: { ...old.sessionStyle, ...style },
      sessionFontKey: fontKey ?? old.sessionFontKey,
    });
  },
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

export const pageInfos = {
  get: (documentId: string, page: number) => get(documentId).pages.get(page) ?? null,
  set(documentId: string, page: number, info: EditPageInfo) {
    const pages = new Map(get(documentId).pages);
    pages.set(page, info);
    patch(documentId, { pages });
  },
};

/**
 * Style for new text (Add Text), kept for the session like Acrobat keeps the last
 * one used. The font key is the picker's choice; the font itself is resolved when the
 * text is written.
 */
let newText: { style: PlainStyle; fontKey: string } | null = null;
const newTextListeners = new Set<() => void>();
export const newTextStyle = {
  get: () => newText,
  set(v: { style: PlainStyle; fontKey: string }) {
    newText = v;
    for (const l of newTextListeners) l();
  },
};
export function useNewTextStyle() {
  return useSyncExternalStore(
    (cb) => {
      newTextListeners.add(cb);
      return () => newTextListeners.delete(cb);
    },
    () => newText,
  );
}

/** Leaving Edit mode: nothing stays selected, open or armed. */
export function resetEdit(documentId: string) {
  patch(documentId, {
    selection: null,
    session: null,
    adding: false,
    sessionStyle: null,
    sessionFontKey: null,
  });
}

export function useEditSelection(documentId: string): EditSelection | null {
  return useSyncExternalStore(subscribe, () => get(documentId).selection);
}

export function useEditSession(documentId: string): EditSession | null {
  return useSyncExternalStore(subscribe, () => get(documentId).session);
}

export function useSessionStyle(documentId: string) {
  return useSyncExternalStore(subscribe, () => get(documentId).sessionStyle);
}

export function useSessionFontKey(documentId: string) {
  return useSyncExternalStore(subscribe, () => get(documentId).sessionFontKey);
}

export function usePageInfo(documentId: string, page: number | null): EditPageInfo | null {
  return useSyncExternalStore(subscribe, () =>
    page === null ? null : (get(documentId).pages.get(page) ?? null),
  );
}

export function useAddingText(documentId: string): boolean {
  return useSyncExternalStore(subscribe, () => get(documentId).adding);
}
