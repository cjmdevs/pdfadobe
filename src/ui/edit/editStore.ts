// Edit PDF (B3): per-document UI state shared by the page layers, the Edit panel, the
// toolbar and the Escape command: the selection, the open text editor, Add Text mode,
// and where to select again once an edited tab has reloaded.
import { useSyncExternalStore } from "react";
import type { EditPageInfo, EditTextBox, PlainStyle } from "../../engine/edit";
import type { CharFmt, ParaFmt } from "./richModel";
import type { ExternalApp } from "../../platform/types";

/** A change from the Format panel to the open editor. */
export interface FormatChange {
  char?: CharFmt;
  para?: ParaFmt;
  /** Increase (1) or decrease (-1) the indent. */
  indent?: 1 | -1;
}

/** The format where the editor's caret is (what the panel shows). */
export interface CaretFormat {
  char: CharFmt;
  para: ParaFmt;
}

/** Interaction mode while the Edit tool is on (EditLayer handles the pointer). */
export const EDIT_MODE = "editPdf";

export interface EditSelection {
  page: number;
  kind: "text" | "image";
  /** Id from editPageInfo for the current bytes. */
  id: number;
  /** Accessible description ("Text: Two invoices dated…", "Image"). */
  label: string;
  /** Other text boxes on the same page picked with Ctrl+click (for Join, Align). */
  more?: number[];
  /** Other images on the same page picked with Ctrl+click (for Align). */
  images?: number[];
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
  /** The format at the open editor's caret. */
  caret: CaretFormat | null;
  /** editPageInfo per page, as the layers last read it. */
  pages: ReadonlyMap<number, EditPageInfo>;
  /** The box an edit left running into other text or a rule, and what it hits. */
  overflow: { page: number; id: number; text: string } | null;
  /** Arrow-key nudges waiting to be written (points). */
  nudge: { dx: number; dy: number } | null;
}

const EMPTY: DocEditState = {
  selection: null,
  session: null,
  adding: false,
  caret: null,
  pages: new Map(),
  overflow: null,
  nudge: null,
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
/** Splits the open editor's box at its caret (registered like the committer). */
const splitters = new Map<string, () => void>();
/** Applies a Format panel change to the open editor (registered like the committer). */
const formatters = new Map<string, (c: FormatChange) => void>();

export const editSession = {
  get: (documentId: string) => get(documentId).session,
  open: (documentId: string, session: EditSession) =>
    patch(documentId, { session, adding: false, caret: null }),
  close: (documentId: string) => patch(documentId, { session: null, caret: null }),
  setCaret: (documentId: string, caret: CaretFormat | null) => patch(documentId, { caret }),
  registerFormatter(documentId: string, fn: ((c: FormatChange) => void) | null) {
    if (fn) formatters.set(documentId, fn);
    else formatters.delete(documentId);
  },
  /** Applies a panel change to the open editor. True when there is one. */
  format(documentId: string, change: FormatChange): boolean {
    const fn = formatters.get(documentId);
    if (!fn) return false;
    fn(change);
    return true;
  },
  registerCommit(documentId: string, fn: (() => void) | null) {
    if (fn) committers.set(documentId, fn);
    else committers.delete(documentId);
  },
  registerSplit(documentId: string, fn: (() => void) | null) {
    if (fn) splitters.set(documentId, fn);
    else splitters.delete(documentId);
  },
  /** Splits the open editor's box at the caret, if an existing box is open. */
  split(documentId: string): boolean {
    const fn = splitters.get(documentId);
    if (!fn) return false;
    fn();
    return true;
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
type Reselect = {
  page: number;
  x: number;
  y: number;
  /** The edit ran into this (shown in the panel once the box is selected again). */
  overflow?: string;
  /** The box's frame settings, carried over to the box the edit wrote. */
  frame?: FrameSettings;
};
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

/** "Show bounding boxes": outline every box and image, not only the hovered one. */
let showBoxes = true;
const showBoxesListeners = new Set<() => void>();
export const boundingBoxes = {
  get: () => showBoxes,
  set(v: boolean) {
    showBoxes = v;
    for (const l of showBoxesListeners) l();
  },
};
export function useShowBoxes() {
  return useSyncExternalStore(
    (cb) => {
      showBoxesListeners.add(cb);
      return () => showBoxesListeners.delete(cb);
    },
    () => showBoxes,
  );
}

/**
 * A text box's frame settings (Acrobat's auto-fit and padding). A PDF has no text-box
 * object, so these live in the app only, for the session: the frame is what the
 * outline, the handles and the X/Y/W/H fields show. Kept per store document and box
 * (by its marked-content id once it has one, which every edit gives it).
 */
export interface FrameSettings {
  /** The frame's height follows the text. */
  autoFit: boolean;
  /** Fixed frame height (points) when auto-fit is off. */
  height: number | null;
  /** Space between the frame and the text (points). */
  padding: number;
}
export const DEFAULT_FRAME: FrameSettings = { autoFit: true, height: null, padding: 1 };
const frames = new Map<string, FrameSettings>();
let framesVersion = 0;
const frameKey = (storeId: string, page: number, box: EditTextBox) =>
  `${storeId}:${page}:${box.boxId !== null ? `id${box.boxId}` : `p${box.preview}`}`;
export const frameSettings = {
  get(storeId: string | undefined, page: number, box: EditTextBox): FrameSettings {
    return (storeId && frames.get(frameKey(storeId, page, box))) || DEFAULT_FRAME;
  },
  set(storeId: string | undefined, page: number, box: EditTextBox, f: Partial<FrameSettings>) {
    if (!storeId) return;
    const k = frameKey(storeId, page, box);
    frames.set(k, { ...(frames.get(k) ?? DEFAULT_FRAME), ...f });
    framesVersion++;
    for (const l of listeners) l();
  },
};
export function useFramesVersion() {
  return useSyncExternalStore(subscribe, () => framesVersion);
}

/** Arrow-key nudges not yet written: the selection is drawn this far off (points). */
export const nudge = {
  get: (documentId: string) => get(documentId).nudge,
  set: (documentId: string, nudge: { dx: number; dy: number } | null) =>
    patch(documentId, { nudge }),
};
export function useNudge(documentId: string) {
  return useSyncExternalStore(subscribe, () => get(documentId).nudge);
}

/**
 * App-wide Edit options: what happens when text grows into content below (Acrobat only
 * warns), and whether image corners keep the proportions (Shift does the other).
 */
let options = { push: false, lockAspect: true };
export const editOptions = {
  get: () => options,
  set(o: Partial<typeof options>) {
    options = { ...options, ...o };
    for (const l of listeners) l();
  },
};
export function useEditOptions() {
  return useSyncExternalStore(subscribe, () => options);
}

/** An image being cropped: the part kept so far (fractions of the picture). */
export interface Cropping {
  page: number;
  id: number;
  part: { x0: number; y0: number; x1: number; y1: number };
}
const crops = new Map<string, Cropping>();
export const cropping = {
  get: (documentId: string) => crops.get(documentId) ?? null,
  set(documentId: string, c: Cropping | null) {
    if (c) crops.set(documentId, c);
    else crops.delete(documentId);
    for (const l of listeners) l();
  },
};
export function useCropping(documentId: string) {
  return useSyncExternalStore(subscribe, () => crops.get(documentId) ?? null);
}

/** Images open in another program (Edit Using), per store document (tab ids change). */
export interface ExternalEditing {
  id: number;
  app: ExternalApp;
  page: number;
  /** Where the image is (its centre): it is found there again after each reload. */
  cx: number;
  cy: number;
}
const externals = new Map<string, ExternalEditing[]>();
export const externalEdits = {
  get: (storeId: string) => externals.get(storeId) ?? [],
  set(storeId: string, list: ExternalEditing[]) {
    if (list.length) externals.set(storeId, list);
    else externals.delete(storeId);
    for (const l of listeners) l();
  },
};
const NONE: ExternalEditing[] = [];
export function useExternalEdits(storeId: string | undefined) {
  return useSyncExternalStore(subscribe, () => (storeId && externals.get(storeId)) || NONE);
}

/** Leaving Edit mode: nothing stays selected, open or armed. */
export function resetEdit(documentId: string) {
  patch(documentId, {
    selection: null,
    session: null,
    adding: false,
    caret: null,
    overflow: null,
    nudge: null,
  });
}

export function useEditSelection(documentId: string): EditSelection | null {
  return useSyncExternalStore(subscribe, () => get(documentId).selection);
}

export function useEditSession(documentId: string): EditSession | null {
  return useSyncExternalStore(subscribe, () => get(documentId).session);
}

export function useCaretFormat(documentId: string) {
  return useSyncExternalStore(subscribe, () => get(documentId).caret);
}

export function usePageInfo(documentId: string, page: number | null): EditPageInfo | null {
  return useSyncExternalStore(subscribe, () =>
    page === null ? null : (get(documentId).pages.get(page) ?? null),
  );
}

export const overflowNote = {
  set: (documentId: string, note: DocEditState["overflow"]) =>
    patch(documentId, { overflow: note }),
};

export function useOverflowNote(documentId: string) {
  return useSyncExternalStore(subscribe, () => get(documentId).overflow);
}

export function useAddingText(documentId: string): boolean {
  return useSyncExternalStore(subscribe, () => get(documentId).adding);
}

/** An image picked with Add Image, waiting for a click (or drag) on a page. */
export interface PendingImage {
  bytes: Uint8Array;
  /** Pixel size, for the default placement size and its proportions. */
  px: { width: number; height: number };
  name: string;
}

const pendingImages = new Map<string, PendingImage>();
export const pendingImage = {
  get: (documentId: string) => pendingImages.get(documentId) ?? null,
  set(documentId: string, img: PendingImage | null) {
    if (img) pendingImages.set(documentId, img);
    else pendingImages.delete(documentId);
    if (img) patch(documentId, { adding: false, selection: null });
    for (const l of listeners) l();
  },
};

export function usePendingImage(documentId: string): PendingImage | null {
  return useSyncExternalStore(subscribe, () => pendingImages.get(documentId) ?? null);
}
