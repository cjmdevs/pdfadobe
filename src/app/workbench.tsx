// App state that sits above the EmbedPDF plugins: which file each tab came from,
// settings persistence, dialogs, toasts, and the open / close / repair / print flows.
// Page operations (Phase 2): every edit produces new PDF bytes, recorded in the document
// store (platform.docs: undo/redo, unsaved flag, path; shared by all windows, backlog B1)
// and shown by reopening the tab's document from those bytes.
// Markup (Phase 3) is edited in the tab's live PDFium document with EmbedPDF's own undo
// history; before anything that reads the store's bytes (page operation, save, moving
// the tab) it is pushed as one "Markup" revision and that history is cleared.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useCoreState } from "@embedpdf/core/react";
import { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { usePrintCapability } from "@embedpdf/plugin-print/react";
import { useAnnotationCapability, useAnnotationPlugin } from "@embedpdf/plugin-annotation/react";
import { useHistoryCapability } from "@embedpdf/plugin-history/react";
import { PdfPermissionFlag, type PdfEngine } from "@embedpdf/models";
import { isLinearized, pdfHeaderVersion } from "../engine/properties";
import {
  PlatformError,
  baseName,
  platform,
  suffixedPath,
  type FileSource,
  type OpenedFile,
} from "../platform";
import { flushFormWrites, takeFieldsDeleted } from "./formWrites";
import { pageOp } from "./pages";
import { calcs } from "../ui/forms/calcStore";
import type { DocInfo } from "./docstore";
import { FALLBACK_AUTHOR } from "../markup/config";
import {
  WINDOW_LOCAL_SETTINGS,
  addRecent,
  removeRecent,
  samePath,
  sanitizeSettings,
  type Settings,
} from "./settings";

/** This window: "main" is the first one; extra windows are "w-1", "w-2"... (backlog B1). */
export const WINDOW_LABEL = platform.windows?.label ?? "main";

export interface DocMeta {
  /** Id in the document store (platform.docs); the same across edits and windows. */
  storeId: string;
  source: FileSource;
  name: string;
  fileSize: number;
  pdfVersion: string | null;
  linearized: boolean;
  /** performance.now() when the open started; used by the perf test. */
  openStartedAt: number;
  /** Tool whose toolbar is open for this tab (src/tools/registry.ts), e.g. "organize". */
  activeTool: string | null;
  /** Pages selected in the Organize grid after the last edit (0-based). */
  pageSelection?: number[] | null;
  /** Selected bookmark in the editor; survives the reload after each edit. */
  bookmark?: number[] | null;
}

export interface EditState {
  undoLabel: string | null;
  redoLabel: string | null;
  dirty: boolean;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  /** Text of the confirming button. */
  ok: string;
  danger?: boolean;
  resolve(yes: boolean): void;
}

export interface EditOptions {
  /** Page to show afterwards (0-based). */
  page?: number;
  /** Pages to have selected in the Organize grid afterwards (0-based). */
  select?: number[];
}

export type Dialog =
  | { kind: "openError"; path: string; error: PlatformError }
  | { kind: "properties"; documentId: string }
  | { kind: "shortcuts" }
  | { kind: "customize" }
  | { kind: "unsaved"; documentIds: string[]; then: "close" | "closeAll" | "closeWindow" }
  /** Ctrl+Q with unsaved documents in any window. */
  | { kind: "quit"; docs: DocInfo[] }
  | { kind: "pageOp"; op: PageOpDialog; documentId: string; pages: number[] }
  /** `documentId`: the open document to start the list with (owner request). */
  | { kind: "combine"; documentId: string | null }
  | { kind: "settings" }
  /** Flatten markup to a new file (Phase 3). */
  | { kind: "flatten"; documentId: string; page: number; selectedIds: string[] }
  /** Stamps picker (Phase 3). */
  | { kind: "stamps"; documentId: string }
  /** Tickmark library and workpaper settings file (Phase 4). */
  | { kind: "tickmarks" }
  /** Workpaper reference and custom fields before a user/status stamp is placed. */
  | { kind: "workpaperStamp"; documentId: string; templateId: string }
  | null;

/** Dialog-driven page operations (src/ui/PageOpsDialogs.tsx). */
export type PageOpDialog = "insert" | "replace" | "crop" | "pageSize" | "split" | "blank";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

export interface WorkbenchApi {
  engine: PdfEngine;
  settings: Settings;
  /** Markup author: the Settings name, else the Windows display name. */
  author: string;
  /** The Windows display name (shown in Settings as the default). */
  osUserName: string | null;
  updateSettings(patch: Partial<Settings>): void;
  meta: Record<string, DocMeta>;
  pickAndOpen(): Promise<void>;
  openPaths(paths: string[], opts?: { quiet?: boolean }): Promise<void>;
  /** `activate: false` opens in the background (a newer open request owns the focus). */
  openFiles(files: OpenedFile[], opts?: { activate?: boolean }): void;
  /** Switch to the tab showing `path`, if open. */
  activatePath(path: string): void;
  closeDocument(id: string): void;
  closeAll(): void;
  repairCopy(id: string): Promise<void>;
  print(id: string, currentPage: number): Promise<void>;
  /** Current bytes of a tab, from the document store (null for tabs that cannot be
   * edited, e.g. encrypted). */
  docBytes(id: string): Promise<Uint8Array | null>;
  /**
   * The store's current bytes without committing unsaved markup first: for reading the
   * page content (Edit PDF outlines), never for writing. Null like docBytes.
   */
  contentBytes(id: string): Promise<Uint8Array | null>;
  editState(id: string): EditState;
  /**
   * Runs a page operation on a tab: `fn` gets the current bytes and returns new ones,
   * which become an undoable step and are shown in the same tab.
   */
  edit(
    id: string,
    label: string,
    fn: (bytes: Uint8Array) => Promise<Uint8Array>,
    opts?: EditOptions,
  ): Promise<boolean>;
  undo(id: string): void;
  redo(id: string): void;
  save(id: string): Promise<boolean>;
  saveAs(id: string): Promise<boolean>;
  /** Opens new, unsaved bytes in a tab (Combine result, extracted pages). */
  openNew(name: string, bytes: Uint8Array): void;
  setSelectedBookmark(id: string, path: number[] | null): void;
  /** Open a tool's toolbar (and view) for a tab, or close it (null); `page` is shown next. */
  setActiveTool(id: string, tool: string | null, page?: number): void;
  /** Pages selected in the Organize grid (tool actions act on them). */
  setPageSelection(id: string, pages: number[]): void;
  /** Close without asking about unsaved changes (after the user chose). */
  forceClose(ids: string[]): void;
  /** Tab drag ended outside the window: move the tab to the window under the pointer. */
  dropTabOutside(id: string): Promise<void>;
  moveToNewWindow(id: string): Promise<void>;
  /** Ctrl+Q: one prompt for unsaved documents in every window, then exit. */
  quit(): Promise<void>;
  /** After the quit prompt: save (or not) the listed documents, then exit. */
  finishQuit(docs: DocInfo[], save: boolean): Promise<void>;
  /** In-app yes/no question (rendered by Dialogs). */
  confirm(req: Omit<ConfirmRequest, "resolve">): Promise<boolean>;
  confirmRequest: ConfirmRequest | null;
  /** What a page operation is doing right now, for the busy indicator. */
  busy: string | null;
  /** Page to show when a tab's view mounts (after a reload, or Organize -> reader). */
  restorePage(id: string): number | null;
  clearRestorePage(id: string): void;
  dialog: Dialog;
  setDialog(d: Dialog): void;
  toasts: Toast[];
  toast(text: string, tone?: Toast["tone"]): void;
  searchOpen: boolean;
  setSearchOpen(open: boolean): void;
  /** Current page per document in Single Page mode (0-based). */
  singlePage: Record<string, number>;
  setSinglePage(id: string, page: number): void;
}

const Ctx = createContext<WorkbenchApi | null>(null);

export function useWorkbench(): WorkbenchApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkbench outside WorkbenchProvider");
  return v;
}

/** User-facing sentence for a file that could not be read. Paths only, never contents. */
export function describeOpenError(e: PlatformError): string {
  switch (e.kind) {
    case "locked":
      return "The file is open in another program that is blocking access. Close it there (or wait for the sync to finish) and try again.";
    case "network":
      return "The network location could not be reached. Check that the share is available and you are connected to the office network or VPN.";
    case "notFound":
      return "The file was not found. It may have been moved, renamed, or deleted.";
    case "accessDenied":
      return "Windows denied access to the file. You may not have permission to open it.";
    case "isDirectory":
      return "That is a folder, not a PDF file.";
    default:
      return e.message;
  }
}

let toastSeq = 0;

/** EmbedPDF's history topic for annotation changes (plugin-annotation 2.15.1). */
const MARKUP_TOPIC = "annotations";
// Form fills (EmbedPDF form plugin, Phase 6) record on their own history topic; they
// live in the tab's PDFium document like markup and are pushed with it.
const LIVE_TOPICS = [MARKUP_TOPIC, "form-fields"];

export function WorkbenchProvider({
  engine,
  initialSettings,
  children,
}: {
  engine: PdfEngine;
  initialSettings: Settings;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [meta, setMeta] = useState<Record<string, DocMeta>>({});
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [singlePage, setSinglePageState] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [osUserName, setOsUserName] = useState<string | null>(null);
  useEffect(() => {
    void platform.userDisplayName().then(setOsUserName);
  }, []);
  const author = settings.authorName ?? osUserName ?? FALLBACK_AUTHOR;
  // Page operations run one at a time, in order; Save and Close wait for them.
  // Each edit reopens the tab under a new id: old id -> new id, to follow a tab.
  const replacedBy = useRef(new Map<string, string>());
  const resolveId = useCallback((id: string) => {
    let cur = id;
    for (let next = replacedBy.current.get(cur); next; next = replacedBy.current.get(cur))
      cur = next;
    return cur;
  }, []);
  const editChain = useRef(Promise.resolve(true));
  const pendingEdits = useRef(0);
  /** Resolves once every requested page operation has finished. */
  const settled = useCallback(() => editChain.current.then(() => undefined), []);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const confirm = useCallback(
    (req: Omit<ConfirmRequest, "resolve">) =>
      new Promise<boolean>((resolve) =>
        setConfirmRequest({
          ...req,
          resolve: (yes) => {
            setConfirmRequest(null);
            resolve(yes);
          },
        }),
      ),
    [],
  );
  // Per document (store id): a mirror of the store's state for rendering (undo labels,
  // unsaved flag). The bytes stay in the store only (in the Windows app, in Rust): the
  // window fetches them when an operation needs them, so it holds no extra copy.
  const [infos, setInfos] = useState<Record<string, DocInfo>>({});
  const infosRef = useRef(infos);
  const setInfo = useCallback((info: DocInfo) => {
    infosRef.current = { ...infosRef.current, [info.id]: info };
    setInfos(infosRef.current);
  }, []);
  // Store calls for one document run in order (creating it may still be in flight).
  const storeQueue = useRef(new Map<string, Promise<unknown>>());
  const queued = useCallback(<T,>(sid: string, fn: () => Promise<T>): Promise<T> => {
    const prev = storeQueue.current.get(sid) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    storeQueue.current.set(
      sid,
      next.catch(() => undefined),
    );
    return next;
  }, []);
  // Documents already checked for digital signatures (none found) in this window.
  const unsigned = useRef(new Set<string>());
  const restorePages = useRef(new Map<string, number>());
  // Paths opened from disk whose .bak may be discarded once they load.
  const pendingBackups = useRef(new Map<string, string>());
  const { provides: docs } = useDocumentManagerCapability();
  const { provides: printer } = usePrintCapability();
  const { provides: annotations } = useAnnotationCapability();
  const { plugin: annotationPlugin } = useAnnotationPlugin();
  const { provides: history } = useHistoryCapability();
  // Markup undo/redo available per tab (EmbedPDF history topic "annotations").
  const [markup, setMarkup] = useState<Record<string, { canUndo: boolean; canRedo: boolean }>>({});
  const core = useCoreState();
  // Latest values for async flows (open/repair/print run across awaits).
  const metaRef = useRef(meta);
  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    metaRef.current = meta;
    settingsRef.current = settings;
  });

  /**
   * Pushes a tab's markup to the store as one "Markup" revision and clears the markup
   * history (its steps now live in that revision). No-op when there is none.
   */
  const commitMarkup = useCallback(
    async (id: string): Promise<void> => {
      const sid = metaRef.current[id]?.storeId;
      const doc = core?.documents[id]?.document;
      const h = history?.forDocument(id);
      if (!sid || !doc || !h) return;
      await flushFormWrites();
      const changed = LIVE_TOPICS.some((t) => h.canUndo(t));
      if (!changed && !LIVE_TOPICS.some((t) => h.canRedo(t))) return;
      if (changed) {
        // EmbedPDF's commit() returns at once while an earlier commit is still running,
        // leaving newer changes (e.g. a quick Ctrl+Y) pending, and saveAsCopy may run
        // before a running commit's PDFium calls. Wait until nothing is pending and no
        // commit runs. `commitInProgress` is the plugin's own lock (2.15.1, not public);
        // without it we fall back to waiting for pending changes only.
        const scope = annotations?.forDocument(id);
        const locks = (annotationPlugin as unknown as { commitInProgress?: Map<string, boolean> })
          ?.commitInProgress;
        for (let i = 0; scope && i < 500; i++) {
          await scope.commit().toPromise();
          if (!scope.getState().hasPendingChanges && !locks?.get(id)) break;
          await new Promise((r) => setTimeout(r, 10));
        }
        // Taken before the copy is made: a field deleted while it is being made stays
        // marked for the next push, which then holds the deletion.
        const cleanFields = takeFieldsDeleted(id);
        let bytes: Uint8Array = new Uint8Array(await engine.saveAsCopy(doc).toPromise());
        if (cleanFields) bytes = (await pageOp("removeOrphanFields", bytes)).bytes;
        // Number fields: plain numbers in /V under their formatted appearance (Acrobat's way).
        const setup = calcs.get(id);
        if (setup && Object.keys(setup.formats).length)
          bytes = await pageOp("rawNumberValues", bytes, setup);
        setInfo(await queued(sid, () => platform.docs.push(sid, bytes, "Markup")));
      }
      for (const t of LIVE_TOPICS) h.purgeByMetadata(() => true, t);
      setMarkup((s) => ({ ...s, [id]: { canUndo: false, canRedo: false } }));
      setInfo(await queued(sid, () => platform.docs.setMarkupPending(sid, false)));
    },
    [annotationPlugin, annotations, core, engine, history, queued, setInfo],
  );

  // Markup changes make the document unsaved (in the store too, for the quit prompt).
  useEffect(() => {
    if (!history) return;
    return history.onHistoryChange(({ documentId, state }) => {
      const ts = LIVE_TOPICS.map((k) => state.topics[k]);
      const t = {
        canUndo: ts.some((x) => x?.canUndo ?? false),
        canRedo: ts.some((x) => x?.canRedo ?? false),
      };
      setMarkup((s) => ({ ...s, [documentId]: { canUndo: t.canUndo, canRedo: t.canRedo } }));
      const sid = metaRef.current[documentId]?.storeId;
      const pending = t.canUndo;
      if (!sid || (infosRef.current[sid]?.markupPending ?? false) === pending) return;
      void queued(sid, () => platform.docs.setMarkupPending(sid, pending))
        .then(setInfo)
        .catch(() => undefined);
    });
  }, [history, queued, setInfo]);

  // Settings: persist every change, in order (tiny JSON; a debounce could lose the
  // last change when the window closes). Only the changed keys are written, on top of
  // what is on disk, since another window may have saved meanwhile. Extra windows keep
  // their view settings to themselves.
  const saveChain = useRef(Promise.resolve());
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    const keep = Object.fromEntries(
      Object.entries(patch).filter(
        ([k]) => WINDOW_LABEL === "main" || !WINDOW_LOCAL_SETTINGS.includes(k as keyof Settings),
      ),
    ) as Partial<Settings>;
    if (Object.keys(keep).length === 0) return;
    saveChain.current = saveChain.current
      .then(async () => {
        let disk: Settings;
        try {
          disk = sanitizeSettings(await platform.loadSettings());
        } catch {
          disk = settingsRef.current;
        }
        await platform.saveSettings({ ...disk, ...keep });
      })
      .catch(() => undefined);
  }, []);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  /** Shows a store document in a new tab. `bytes` is the viewer's own copy. */
  const addTab = useCallback(
    (storeId: string, source: FileSource, name: string, bytes: ArrayBuffer, activate: boolean) => {
      if (!docs) return;
      const head = new Uint8Array(bytes, 0, Math.min(1024, bytes.byteLength));
      const documentId = crypto.randomUUID();
      const m: DocMeta = {
        storeId,
        source,
        name,
        fileSize: bytes.byteLength,
        pdfVersion: pdfHeaderVersion(head),
        linearized: isLinearized(head),
        openStartedAt: performance.now(),
        activeTool: null,
      };
      metaRef.current = { ...metaRef.current, [documentId]: m };
      setMeta(metaRef.current);
      docs.openDocumentBuffer({ buffer: bytes, name, documentId, autoActivate: activate });
      return documentId;
    },
    [docs],
  );

  const openFiles = useCallback(
    (files: OpenedFile[], { activate = true }: { activate?: boolean } = {}) => {
      if (!docs) return;
      for (const f of files) {
        if (f.source.kind === "path") {
          const path = f.source.path;
          const existing = Object.entries(metaRef.current).find(
            ([, m]) => m.source.kind === "path" && samePath(m.source.path, path),
          );
          if (existing) {
            if (activate) docs.setActiveDocument(existing[0]);
            continue;
          }
        }
        const storeId = crypto.randomUUID();
        // A copy: the viewer's worker may take ownership of f.bytes.
        const copy = new Uint8Array(f.bytes.slice(0));
        const path = f.source.kind === "path" ? f.source.path : null;
        void queued(storeId, () =>
          platform.docs.create(storeId, copy, { name: f.name, path, saved: true }).then(setInfo),
        );
        const documentId = addTab(storeId, f.source, f.name, f.bytes, activate);
        if (documentId && f.source.kind === "path")
          pendingBackups.current.set(documentId, f.source.path);
      }
    },
    [addTab, docs, queued, setInfo],
  );

  /** Same file already open in another window: switch to that window (owner decision). */
  const openElsewhere = useCallback(async (path: string) => {
    if (!platform.windows) return false;
    const hit = await platform.docs.findPath(path).catch(() => null);
    if (!hit || hit.window === WINDOW_LABEL) return false;
    return platform.windows.focusDoc(hit.id);
  }, []);

  // Reads are async (network shares can be slow). Only the newest open request may switch
  // tabs, so opening A then B always ends on B even if A's read finishes last.
  const openSeq = useRef(0);
  const openPaths = useCallback(
    async (paths: string[], opts: { quiet?: boolean } = {}) => {
      const seq = ++openSeq.current;
      for (const path of paths) {
        try {
          if (await openElsewhere(path)) continue;
          const file = await platform.readPath(path);
          openFiles([file], { activate: seq === openSeq.current });
          updateSettings({ recent: addRecent(settingsRef.current.recent, path) });
        } catch (e) {
          const err = e instanceof PlatformError ? e : new PlatformError("other", String(e));
          if (opts.quiet) toast(`Could not reopen ${path}: ${describeOpenError(err)}`, "error");
          else setDialog({ kind: "openError", path, error: err });
        }
      }
    },
    [openElsewhere, openFiles, toast, updateSettings],
  );

  const pickAndOpen = useCallback(async () => {
    try {
      const picked = await platform.pickFiles();
      openSeq.current++; // this choice wins over slower reads still in flight
      const files: OpenedFile[] = [];
      for (const f of picked)
        if (!(f.source.kind === "path" && (await openElsewhere(f.source.path)))) files.push(f);
      openFiles(files);
      let recent = settingsRef.current.recent;
      for (const f of files)
        if (f.source.kind === "path") recent = addRecent(recent, f.source.path);
      updateSettings({ recent });
    } catch (e) {
      const err = e instanceof PlatformError ? e : new PlatformError("other", String(e));
      setDialog({ kind: "openError", path: "", error: err });
    }
  }, [openElsewhere, openFiles, updateSettings]);

  const activatePath = useCallback(
    (path: string) => {
      const hit = Object.entries(metaRef.current).find(
        ([, m]) => m.source.kind === "path" && samePath(m.source.path, path),
      );
      if (hit) docs?.setActiveDocument(hit[0]);
    },
    [docs],
  );

  const forget = useCallback(
    (ids: string[]) => {
      for (const id of ids) {
        pendingBackups.current.delete(id);
        restorePages.current.delete(id);
      }
      const rest = Object.fromEntries(
        Object.entries(metaRef.current).filter(([k]) => !ids.includes(k)),
      );
      metaRef.current = rest;
      setMeta(rest);
      // EmbedPDF picks the next tab only once PDFium has closed the document; until then
      // the closing one would stay active and Ctrl+W, Ctrl+Z etc. would act on it. Pick
      // now, like EmbedPDF does: the tab before it, else the one after.
      const active = docs?.getActiveDocumentId();
      if (!docs || !active || !ids.includes(active)) return;
      const order = docs.getDocumentOrder();
      const at = order.indexOf(active);
      const left = order.slice(0, at).filter((id) => rest[id]);
      const next = left.at(-1) ?? order.slice(at + 1).find((id) => rest[id]);
      if (next) docs.setActiveDocument(next);
    },
    [docs],
  );

  /** Closes tabs for good: the store forgets their documents. */
  const forceClose = useCallback(
    (ids: string[]) => {
      for (const id of ids) {
        docs?.closeDocument(id);
        const sid = metaRef.current[id]?.storeId;
        if (!sid) continue;
        unsigned.current.delete(sid);
        void queued(sid, () => platform.docs.release(sid)).catch(() => undefined);
      }
      forget(ids);
    },
    [docs, forget, queued],
  );

  /** Tabs moved to another window: close them here; the store keeps their documents. */
  const detach = useCallback(
    (ids: string[]) => {
      for (const id of ids) {
        docs?.closeDocument(id);
      }
      forget(ids);
      // An extra window closes once its last tab has left (like a browser).
      if (WINDOW_LABEL !== "main" && Object.keys(metaRef.current).length === 0)
        void platform.windows?.closeWindow();
    },
    [docs, forget],
  );

  /** Documents handed to this window by another one (or queued for a new window). */
  const adopt = useCallback(async () => {
    const wins = platform.windows;
    if (!wins) return;
    for (const sid of await wins.takeDocs()) {
      try {
        const [info, bytes] = await Promise.all([
          platform.docs.info(sid),
          platform.docs.current(sid),
        ]);
        setInfo(info);
        const source: FileSource = info.path
          ? { kind: "path", path: info.path }
          : { kind: "memory", name: info.name };
        addTab(sid, source, info.name, bytes.slice().buffer, true);
      } catch (e) {
        toast(
          `Could not move a document here: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
      }
    }
  }, [addTab, setInfo, toast]);

  const moveOut = useCallback(
    async (id: string, how: "drop" | "new") => {
      const wins = platform.windows;
      if (!wins) return;
      await settled();
      const now = resolveId(id);
      const sid = metaRef.current[now]?.storeId;
      if (!sid) return;
      try {
        await commitMarkup(now);
        await queued(sid, async () => undefined);
        if (how === "new") await wins.moveToNewWindow([sid]);
        else if (!(await wins.tabDrop([sid]))) return;
        detach([now]);
      } catch (e) {
        toast(`Could not move the tab: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
    [commitMarkup, detach, queued, resolveId, settled, toast],
  );
  const dropTabOutside = useCallback((id: string) => moveOut(id, "drop"), [moveOut]);
  const moveToNewWindow = useCallback((id: string) => moveOut(id, "new"), [moveOut]);

  // Another window moved tabs here, or asked this one to show a document again.
  useEffect(() => {
    const wins = platform.windows;
    if (!wins || !docs) return;
    // Documents queued before this window started (a new window, or a missed event).
    void Promise.resolve().then(adopt);
    const offs = [
      wins.onAdopt(() => void adopt()),
      wins.onFocusDoc((sid) => {
        const hit = Object.entries(metaRef.current).find(([, m]) => m.storeId === sid);
        if (hit) docs.setActiveDocument(hit[0]);
      }),
    ];
    return () => offs.forEach((p) => void p.then((off) => off()));
  }, [adopt, docs]);

  /** Store state of a tab's document (after its pending store calls). */
  const infoOf = useCallback(
    async (id: string): Promise<DocInfo | null> => {
      const sid = metaRef.current[id]?.storeId;
      if (!sid) return null;
      await queued(sid, async () => undefined);
      return infosRef.current[sid] ?? null;
    },
    [queued],
  );

  const closeDocument = useCallback(
    (id: string) => {
      // After any running page operation: it may make the document dirty (or replace it).
      void settled().then(async () => {
        const now = resolveId(id);
        if ((await infoOf(now))?.dirty) {
          setDialog({ kind: "unsaved", documentIds: [now], then: "close" });
          return;
        }
        forceClose([now]);
      });
    },
    [forceClose, infoOf, resolveId, settled],
  );

  const closeAll = useCallback(() => {
    void settled().then(async () => {
      const ids = Object.keys(metaRef.current);
      const dirty: string[] = [];
      for (const id of ids) if ((await infoOf(id))?.dirty) dirty.push(id);
      if (dirty.length) {
        setDialog({ kind: "unsaved", documentIds: dirty, then: "closeAll" });
        return;
      }
      forceClose(ids);
    });
  }, [forceClose, infoOf, settled]);

  const repairCopy = useCallback(
    async (id: string) => {
      const m = metaRef.current[id];
      if (!m || m.source.kind !== "path") return;
      const source = m.source.path;
      const target = await platform.pickSavePath(suffixedPath(source, "repaired"));
      if (!target) return;
      if (samePath(target, source)) {
        toast("Choose a new file name. The original is never overwritten.", "error");
        return;
      }
      try {
        const r = await platform.repair(source, target);
        toast(r.hadWarnings ? "Repaired copy saved. qpdf fixed structural damage." : "Copy saved.");
        closeDocument(id);
        await openPaths([target]);
      } catch (e) {
        const err = e instanceof PlatformError ? e : new PlatformError("other", String(e));
        toast(
          err.kind === "unrepairable"
            ? `qpdf could not repair this file: ${err.message}`
            : err.kind === "qpdfMissing"
              ? "qpdf is not installed, so the file cannot be repaired."
              : `Repair failed: ${err.message}`,
          "error",
        );
      }
    },
    [closeDocument, openPaths, toast],
  );

  const print = useCallback(
    async (id: string, currentPage: number) => {
      const doc = core?.documents[id]?.document;
      const m = metaRef.current[id];
      if (!doc || !m) return;
      if (doc.isEncrypted && (doc.permissions & PdfPermissionFlag.Print) === 0) {
        toast("This document's security settings do not allow printing.", "error");
        return;
      }
      try {
        const bytes = await engine
          .preparePrintDocument(doc, { includeAnnotations: true })
          .toPromise();
        const r = await platform.print({
          bytes,
          title: m.name,
          scaling: settingsRef.current.printScaling,
          autoRotate: settingsRef.current.printAutoRotate,
          currentPage,
        });
        if (r.status === "printed") toast(`Sent ${r.pages} page(s) to the printer.`);
      } catch (e) {
        if (e instanceof PlatformError && e.kind === "unsupported" && printer) {
          // WebView print (Edge's PDF print preview). Used outside Windows or when
          // pdfium.dll is missing from the install.
          printer.forDocument(id).print({ includeAnnotations: true });
          return;
        }
        toast(`Printing failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
    [core, engine, printer, toast],
  );

  /**
   * Shows `bytes` in the tab `id`: a new EmbedPDF document takes the old one's place in
   * the tab order, inheriting its file info and history. Returns the new id.
   */
  const showRevision = useCallback(
    (
      id: string,
      bytes: Uint8Array,
      page: number | null,
      select: number[] | null = null,
    ): string | null => {
      const m = metaRef.current[id];
      if (!docs || !m) return null;
      const index = docs.getDocumentIndex(id);
      const newId = crypto.randomUUID();
      replacedBy.current.set(id, newId);
      if (page !== null) restorePages.current.set(newId, page);
      metaRef.current = {
        ...metaRef.current,
        [newId]: {
          ...m,
          fileSize: bytes.byteLength,
          openStartedAt: performance.now(),
          pageSelection: select,
        },
      };
      setMeta(metaRef.current);
      // Keep the view rotation (Ctrl+Shift+Plus) the reader had.
      const rotation = core?.documents[id]?.rotation;
      docs.openDocumentBuffer({
        buffer: bytes.slice().buffer,
        name: m.name,
        documentId: newId,
        autoActivate: true,
        ...(rotation === undefined ? {} : { rotation }),
      });
      if (index >= 0) docs.moveDocument(newId, index);
      docs.closeDocument(id);
      forget([id]);
      return newId;
    },
    [core, docs, forget],
  );

  /** A document's current bytes from the store (after its pending store calls). */
  const storeBytes = useCallback(
    (sid: string) => queued(sid, () => platform.docs.current(sid)),
    [queued],
  );

  const docBytes = useCallback(
    async (id: string) => {
      const doc = core?.documents[id]?.document;
      if (doc?.isEncrypted) return null;
      const sid = metaRef.current[id]?.storeId;
      if (!sid) return null;
      await commitMarkup(id);
      return storeBytes(sid).catch(() => null);
    },
    [commitMarkup, core, storeBytes],
  );

  const contentBytes = useCallback(
    async (id: string) => {
      if (core?.documents[id]?.document?.isEncrypted) return null;
      const sid = metaRef.current[id]?.storeId;
      return sid ? storeBytes(sid).catch(() => null) : null;
    },
    [core, storeBytes],
  );

  const editState = useCallback(
    (id: string): EditState => {
      const info = infos[meta[id]?.storeId ?? ""];
      const m = markup[id];
      return {
        undoLabel: m?.canUndo ? "Markup" : (info?.undoLabel ?? null),
        redoLabel: m?.canRedo ? "Markup" : (info?.redoLabel ?? null),
        dirty: (info?.dirty ?? false) || (m?.canUndo ?? false),
      };
    },
    [infos, markup, meta],
  );

  // One page operation at a time: they all read the latest bytes.
  const edit = useCallback(
    (
      id: string,
      label: string,
      fn: (bytes: Uint8Array) => Promise<Uint8Array>,
      opts: EditOptions = {},
    ): Promise<boolean> => {
      // Busy from the click on, not only once the work starts: Save, Close and the
      // shortcuts must never act on the state before this edit.
      pendingEdits.current++;
      setBusy(label);
      const run = async () => {
        const sid = metaRef.current[id]?.storeId;
        const doc = core?.documents[id]?.document;
        if (!sid) return false;
        if (doc?.isEncrypted) {
          toast(
            "This document is password-protected. Page changes need an unprotected copy.",
            "error",
          );
          return false;
        }
        const accepted = (await infoOf(id))?.signatureAccepted ?? false;
        if (doc && !accepted && !unsigned.current.has(sid)) {
          const sigs = await engine
            .getSignatures(doc)
            .toPromise()
            .catch(() => []);
          if (
            sigs.length &&
            !(await confirm({
              title: "Digitally signed document",
              message:
                `This document is digitally signed (${sigs.length} signature${sigs.length === 1 ? "" : "s"}). ` +
                "Changing its pages will make the signature invalid. The original file is not " +
                "changed until you save.",
              ok: "Change anyway",
              danger: true,
            }))
          ) {
            return false;
          }
          if (sigs.length) setInfo(await queued(sid, () => platform.docs.acceptSignature(sid)));
          else unsigned.current.add(sid);
        }
        try {
          await commitMarkup(id);
          const next = await fn(await storeBytes(sid));
          let info = await queued(sid, () => platform.docs.push(sid, next, label));
          if (info.trimmed) {
            toast("Undo history is full; the oldest steps for this document were dropped.");
            info = await queued(sid, () => platform.docs.clearTrimmed(sid));
          }
          setInfo(info);
          showRevision(id, next, opts.page ?? null, opts.select ?? null);
          return true;
        } catch (e) {
          toast(`${label} failed: ${e instanceof Error ? e.message : String(e)}`, "error");
          return false;
        }
      };
      const done = (ok: boolean) => {
        if (--pendingEdits.current === 0) setBusy(null);
        return ok;
      };
      editChain.current = editChain.current.then(run, run).then(done, () => done(false));
      return editChain.current;
    },
    [commitMarkup, confirm, core, engine, infoOf, queued, setInfo, showRevision, storeBytes, toast],
  );

  /** Undo / redo: run after any page operation still in progress. */
  const step = useCallback(
    (id: string, which: "undo" | "redo") => {
      const run = async () => {
        const now = resolveId(id);
        const sid = metaRef.current[now]?.storeId;
        if (!sid) return true;
        // Markup steps first (they sit on top of the store's current revision).
        const h = history?.forDocument(now);
        if (h && LIVE_TOPICS.some((t) => (which === "undo" ? h.canUndo(t) : h.canRedo(t)))) {
          if (which === "undo") h.undo();
          else h.redo();
          toast(`${which === "undo" ? "Undid" : "Redid"}: Markup`);
          return true;
        }
        const before = infosRef.current[sid];
        const label = which === "undo" ? before?.undoLabel : before?.redoLabel;
        const r = await queued(sid, () =>
          which === "undo" ? platform.docs.undo(sid) : platform.docs.redo(sid),
        );
        if (!r) return true;
        setInfo(r.info);
        showRevision(now, r.bytes, null);
        toast(`${which === "undo" ? "Undid" : "Redid"}: ${label}`);
        return true;
      };
      editChain.current = editChain.current.then(run, run).catch(() => true);
    },
    [history, queued, resolveId, setInfo, showRevision, toast],
  );
  const undo = useCallback((id: string) => step(id, "undo"), [step]);
  const redo = useCallback((id: string) => step(id, "redo"), [step]);

  const saveAs = useCallback(
    async (requested: string): Promise<boolean> => {
      await settled();
      const id = resolveId(requested);
      const m = metaRef.current[id];
      if (!m) return false;
      const source = m.source.kind === "path" ? m.source.path : null;
      const target = await platform.pickSavePath(source ?? m.name);
      if (!target) return false;
      if (source && samePath(target, source)) {
        toast("Choose a new file name, or use Save (Ctrl+S) to update this file.", "error");
        return false;
      }
      try {
        await commitMarkup(id);
        await platform.saveAs(target, source, await storeBytes(m.storeId));
      } catch (e) {
        const err = e instanceof PlatformError ? e : new PlatformError("other", String(e));
        toast(`Could not save: ${describeOpenError(err)}`, "error");
        return false;
      }
      const name = baseName(target);
      setInfo(
        await queued(m.storeId, () => platform.docs.markSaved(m.storeId, { path: target, name })),
      );
      metaRef.current = {
        ...metaRef.current,
        [id]: { ...m, source: { kind: "path", path: target }, name },
      };
      setMeta(metaRef.current);
      updateSettings({ recent: addRecent(settingsRef.current.recent, target) });
      toast(`Saved as ${name}.`);
      return true;
    },
    [commitMarkup, queued, resolveId, setInfo, settled, storeBytes, toast, updateSettings],
  );

  const save = useCallback(
    async (requested: string): Promise<boolean> => {
      await settled();
      const id = resolveId(requested);
      const m = metaRef.current[id];
      if (!m) return false;
      if (m.source.kind !== "path") return saveAs(id);
      try {
        await commitMarkup(id);
        await platform.save(m.source.path, await storeBytes(m.storeId));
      } catch (e) {
        const err = e instanceof PlatformError ? e : new PlatformError("other", String(e));
        if (err.kind === "unverified") {
          // Written, but not what the app showed: the tab stays unsaved, .bak stays.
          toast(
            `${m.name} was saved, but reading it back did not match. The previous version is kept as ${m.name}.bak. Check the file before closing it.`,
            "error",
          );
        } else toast(`Could not save: ${describeOpenError(err)} Try Save As.`, "error");
        return false;
      }
      setInfo(await queued(m.storeId, () => platform.docs.markSaved(m.storeId)));
      toast(`Saved ${m.name}.`);
      return true;
    },
    [commitMarkup, queued, resolveId, saveAs, setInfo, settled, storeBytes, toast],
  );

  const openNew = useCallback(
    (name: string, bytes: Uint8Array) => {
      if (!docs) return;
      const documentId = crypto.randomUUID();
      const storeId = crypto.randomUUID();
      metaRef.current = {
        ...metaRef.current,
        [documentId]: {
          storeId,
          source: { kind: "memory", name },
          name,
          fileSize: bytes.byteLength,
          pdfVersion: pdfHeaderVersion(bytes.subarray(0, 1024)),
          linearized: false,
          openStartedAt: performance.now(),
          activeTool: null,
        },
      };
      setMeta(metaRef.current);
      void queued(storeId, () =>
        platform.docs.create(storeId, bytes, { name, path: null, saved: false }).then(setInfo),
      );
      docs.openDocumentBuffer({
        buffer: bytes.slice().buffer,
        name,
        documentId,
        autoActivate: true,
      });
    },
    [docs, queued, setInfo],
  );

  const setSelectedBookmark = useCallback((id: string, path: number[] | null) => {
    const m = metaRef.current[id];
    if (!m) return;
    metaRef.current = { ...metaRef.current, [id]: { ...m, bookmark: path } };
    setMeta(metaRef.current);
  }, []);

  const setActiveTool = useCallback((id: string, tool: string | null, page?: number) => {
    const m = metaRef.current[id];
    if (!m) return;
    if (page !== undefined) restorePages.current.set(id, page);
    metaRef.current = { ...metaRef.current, [id]: { ...m, activeTool: tool } };
    setMeta(metaRef.current);
  }, []);

  const setPageSelection = useCallback((id: string, pages: number[]) => {
    const m = metaRef.current[id];
    if (!m) return;
    metaRef.current = { ...metaRef.current, [id]: { ...m, pageSelection: pages } };
    setMeta(metaRef.current);
  }, []);

  // Read during render (StrictMode may render twice), cleared by the view's effect.
  const restorePage = useCallback((id: string) => restorePages.current.get(id) ?? null, []);
  const clearRestorePage = useCallback((id: string) => {
    restorePages.current.delete(id);
  }, []);

  // A file saved earlier keeps "<name>.bak" until it opens successfully again.
  useEffect(() => {
    if (!docs) return;
    return docs.onDocumentOpened((state) => {
      const path = pendingBackups.current.get(state.id);
      if (!path) return;
      pendingBackups.current.delete(state.id);
      platform.discardBackup(path).catch(() => undefined);
    });
  }, [docs]);

  const setSinglePage = useCallback((id: string, page: number) => {
    setSinglePageState((s) => ({ ...s, [id]: page }));
  }, []);

  // Open tabs are remembered as paths, in tab order.
  const order = core?.documentOrder;
  const active = core?.activeDocumentId ?? null;
  useEffect(() => {
    if (!order) return;
    const pathOf = (id: string) => {
      const s = meta[id]?.source;
      return s?.kind === "path" ? s.path : null;
    };
    const openTabs = order.map(pathOf).filter((p): p is string => p !== null);
    const activeTab = active ? pathOf(active) : null;
    const cur = settingsRef.current;
    if (openTabs.join("\n") !== cur.openTabs.join("\n") || activeTab !== cur.activeTab) {
      updateSettings({ openTabs, activeTab });
    }
  }, [order, active, meta, updateSettings]);

  // Window title follows the active tab.
  useEffect(() => {
    const name = active ? meta[active]?.name : null;
    platform.setTitle(name ? `${name} - PDF Workbench` : "PDF Workbench");
  }, [active, meta]);

  // Ctrl+Q: one prompt listing unsaved documents in every window.
  const quit = useCallback(async () => {
    const wins = platform.windows;
    if (!wins) return;
    await settled();
    const dirty = await platform.docs.dirty();
    if (dirty.length) setDialog({ kind: "quit", docs: dirty });
    else await wins.quit();
  }, [settled]);

  const finishQuit = useCallback(
    async (list: DocInfo[], saveFirst: boolean) => {
      const wins = platform.windows;
      if (!wins) return;
      if (saveFirst) {
        for (const d of list) {
          const tab = Object.entries(metaRef.current).find(([, m]) => m.storeId === d.id)?.[0];
          if (tab) {
            // Shown here: the normal Save (Save As for a file never saved).
            if (!(await save(tab))) return;
          } else if (d.markupPending) {
            // Its comments live in the other window's document until that window saves.
            toast(`“${d.name}” has unsaved comments. Save it from its window first.`, "error");
            void wins.focusDoc(d.id);
            return;
          } else if (d.path) {
            try {
              await wins.saveDoc(d.id);
            } catch (e) {
              toast(
                `Could not save ${d.name}: ${e instanceof Error ? e.message : String(e)}`,
                "error",
              );
              return;
            }
          } else {
            toast(`“${d.name}” has never been saved. Save it from its window first.`, "error");
            void wins.focusDoc(d.id);
            return;
          }
        }
      }
      await wins.quit();
    },
    [save, toast],
  );

  // Window close button: ask about this window's unsaved documents first.
  useEffect(() => {
    const wins = platform.windows;
    if (!wins) return;
    const off = wins.onCloseRequested(async () => {
      await settled();
      const dirty: string[] = [];
      for (const id of Object.keys(metaRef.current)) if ((await infoOf(id))?.dirty) dirty.push(id);
      if (dirty.length === 0) return true;
      setDialog({ kind: "unsaved", documentIds: dirty, then: "closeWindow" });
      return false;
    });
    return () => void off.then((f) => f());
  }, [infoOf, settled]);

  const api = useMemo<WorkbenchApi>(
    () => ({
      engine,
      settings,
      author,
      osUserName,
      updateSettings,
      meta,
      pickAndOpen,
      openPaths,
      openFiles,
      activatePath,
      closeDocument,
      closeAll,
      repairCopy,
      print,
      dialog,
      setDialog,
      toasts,
      toast,
      searchOpen,
      setSearchOpen,
      singlePage,
      setSinglePage,
      docBytes,
      contentBytes,
      editState,
      edit,
      undo,
      redo,
      save,
      saveAs,
      openNew,
      setActiveTool,
      setPageSelection,
      setSelectedBookmark,
      forceClose,
      dropTabOutside,
      moveToNewWindow,
      quit,
      finishQuit,
      busy,
      confirm,
      confirmRequest,
      restorePage,
      clearRestorePage,
    }),
    [
      engine,
      settings,
      author,
      osUserName,
      updateSettings,
      meta,
      pickAndOpen,
      openPaths,
      openFiles,
      activatePath,
      closeDocument,
      closeAll,
      repairCopy,
      print,
      dialog,
      toasts,
      toast,
      searchOpen,
      singlePage,
      setSinglePage,
      docBytes,
      contentBytes,
      editState,
      edit,
      undo,
      redo,
      save,
      saveAs,
      openNew,
      setActiveTool,
      setPageSelection,
      setSelectedBookmark,
      forceClose,
      dropTabOutside,
      moveToNewWindow,
      quit,
      finishQuit,
      busy,
      confirm,
      confirmRequest,
      restorePage,
      clearRestorePage,
    ],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** Remove a path from Recent Files (e.g. after "not found"). */
export function useForgetRecent() {
  const { settings, updateSettings } = useWorkbench();
  return useCallback(
    (path: string) => updateSettings({ recent: removeRecent(settings.recent, path) }),
    [settings.recent, updateSettings],
  );
}
