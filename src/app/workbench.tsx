// App state that sits above the EmbedPDF plugins: which file each tab came from,
// settings persistence, dialogs, toasts, and the open / close / repair / print flows.
// Page operations (Phase 2): every edit produces new PDF bytes, recorded in the tab's
// EditHistory (undo/redo) and shown by reopening the tab's document from those bytes.

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
import { EditHistory } from "./history";
import { addRecent, removeRecent, samePath, type Settings } from "./settings";

export interface DocMeta {
  source: FileSource;
  name: string;
  fileSize: number;
  pdfVersion: string | null;
  linearized: boolean;
  /** performance.now() when the open started; used by the perf test. */
  openStartedAt: number;
  /** Organize view (page grid) instead of the reader. */
  organize: boolean;
  /** Selected bookmark in the editor; survives the reload after each edit. */
  bookmark?: number[] | null;
}

export interface EditState {
  undoLabel: string | null;
  redoLabel: string | null;
  dirty: boolean;
}

export interface EditOptions {
  /** Page to show afterwards (0-based). */
  page?: number;
}

export type Dialog =
  | { kind: "openError"; path: string; error: PlatformError }
  | { kind: "properties"; documentId: string }
  | { kind: "shortcuts" }
  | { kind: "unsaved"; documentIds: string[]; then: "close" | "closeAll" }
  | { kind: "pageOp"; op: PageOpDialog; documentId: string; pages: number[] }
  | { kind: "combine" }
  | null;

/** Dialog-driven page operations (src/ui/PageOpsDialogs.tsx). */
export type PageOpDialog = "insert" | "replace" | "crop" | "pageSize" | "split" | "blank";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

interface WorkbenchApi {
  engine: PdfEngine;
  settings: Settings;
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
  /** Current bytes of a tab (null for tabs that cannot be edited, e.g. encrypted). */
  docBytes(id: string): Uint8Array | null;
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
  /** Switch between reader and Organize grid; `page` is shown in the new view. */
  setOrganize(id: string, on: boolean, page?: number): void;
  /** Close without asking about unsaved changes (after the user chose). */
  forceClose(ids: string[]): void;
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
  // Edit history per tab, keyed by the EmbedPDF document id (moved when a tab reloads).
  const histories = useRef(new Map<string, EditHistory>());
  const restorePages = useRef(new Map<string, number>());
  // Paths opened from disk whose .bak may be discarded once they load.
  const pendingBackups = useRef(new Map<string, string>());
  const [, setHistoryTick] = useState(0);
  const historyChanged = useCallback(() => setHistoryTick((t) => t + 1), []);
  const { provides: docs } = useDocumentManagerCapability();
  const { provides: printer } = usePrintCapability();
  const core = useCoreState();
  // Latest values for async flows (open/repair/print run across awaits).
  const metaRef = useRef(meta);
  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    metaRef.current = meta;
    settingsRef.current = settings;
  });

  // Settings: persist every change, in order (tiny JSON; a debounce could lose the
  // last change when the window closes).
  const saveChain = useRef(Promise.resolve());
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveChain.current = saveChain.current
        .then(() => platform.saveSettings(next))
        .catch(() => undefined);
      return next;
    });
  }, []);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

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
        const head = new Uint8Array(f.bytes, 0, Math.min(1024, f.bytes.byteLength));
        const documentId = crypto.randomUUID();
        const m: DocMeta = {
          source: f.source,
          name: f.name,
          fileSize: f.bytes.byteLength,
          pdfVersion: pdfHeaderVersion(head),
          linearized: isLinearized(head),
          openStartedAt: performance.now(),
          organize: false,
        };
        metaRef.current = { ...metaRef.current, [documentId]: m };
        setMeta(metaRef.current);
        // A copy: the viewer's worker may take ownership of f.bytes.
        histories.current.set(documentId, new EditHistory(new Uint8Array(f.bytes.slice(0))));
        if (f.source.kind === "path") pendingBackups.current.set(documentId, f.source.path);
        docs.openDocumentBuffer({
          buffer: f.bytes,
          name: f.name,
          documentId,
          autoActivate: activate,
        });
      }
    },
    [docs],
  );

  // Reads are async (network shares can be slow). Only the newest open request may switch
  // tabs, so opening A then B always ends on B even if A's read finishes last.
  const openSeq = useRef(0);
  const openPaths = useCallback(
    async (paths: string[], opts: { quiet?: boolean } = {}) => {
      const seq = ++openSeq.current;
      for (const path of paths) {
        try {
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
    [openFiles, toast, updateSettings],
  );

  const pickAndOpen = useCallback(async () => {
    try {
      const files = await platform.pickFiles();
      openSeq.current++; // this choice wins over slower reads still in flight
      openFiles(files);
      let recent = settingsRef.current.recent;
      for (const f of files)
        if (f.source.kind === "path") recent = addRecent(recent, f.source.path);
      updateSettings({ recent });
    } catch (e) {
      const err = e instanceof PlatformError ? e : new PlatformError("other", String(e));
      setDialog({ kind: "openError", path: "", error: err });
    }
  }, [openFiles, updateSettings]);

  const activatePath = useCallback(
    (path: string) => {
      const hit = Object.entries(metaRef.current).find(
        ([, m]) => m.source.kind === "path" && samePath(m.source.path, path),
      );
      if (hit) docs?.setActiveDocument(hit[0]);
    },
    [docs],
  );

  const forget = useCallback((ids: string[]) => {
    for (const id of ids) {
      histories.current.delete(id);
      pendingBackups.current.delete(id);
      restorePages.current.delete(id);
    }
    const rest = Object.fromEntries(
      Object.entries(metaRef.current).filter(([k]) => !ids.includes(k)),
    );
    metaRef.current = rest;
    setMeta(rest);
  }, []);

  const forceClose = useCallback(
    (ids: string[]) => {
      for (const id of ids) docs?.closeDocument(id);
      forget(ids);
    },
    [docs, forget],
  );

  const closeDocument = useCallback(
    (id: string) => {
      if (histories.current.get(id)?.dirty) {
        setDialog({ kind: "unsaved", documentIds: [id], then: "close" });
        return;
      }
      forceClose([id]);
    },
    [forceClose],
  );

  const closeAll = useCallback(() => {
    const dirty = Object.keys(metaRef.current).filter((id) => histories.current.get(id)?.dirty);
    if (dirty.length) {
      setDialog({ kind: "unsaved", documentIds: dirty, then: "closeAll" });
      return;
    }
    docs?.closeAllDocuments();
    forget(Object.keys(metaRef.current));
  }, [docs, forget]);

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
    (id: string, bytes: Uint8Array, page: number | null): string | null => {
      const m = metaRef.current[id];
      const h = histories.current.get(id);
      if (!docs || !m || !h) return null;
      const index = docs.getDocumentIndex(id);
      const newId = crypto.randomUUID();
      histories.current.set(newId, h);
      histories.current.delete(id);
      if (page !== null) restorePages.current.set(newId, page);
      metaRef.current = {
        ...metaRef.current,
        [newId]: { ...m, fileSize: bytes.byteLength, openStartedAt: performance.now() },
      };
      setMeta(metaRef.current);
      docs.openDocumentBuffer({
        buffer: bytes.slice().buffer,
        name: m.name,
        documentId: newId,
        autoActivate: true,
      });
      if (index >= 0) docs.moveDocument(newId, index);
      docs.closeDocument(id);
      forget([id]);
      return newId;
    },
    [docs, forget],
  );

  const docBytes = useCallback(
    (id: string) => {
      const doc = core?.documents[id]?.document;
      if (doc?.isEncrypted) return null;
      return histories.current.get(id)?.current ?? null;
    },
    [core],
  );

  const editState = useCallback((id: string): EditState => {
    const h = histories.current.get(id);
    return {
      undoLabel: h?.undoLabel ?? null,
      redoLabel: h?.redoLabel ?? null,
      dirty: h?.dirty ?? false,
    };
  }, []);

  // One page operation at a time: they all read the latest bytes.
  const editChain = useRef(Promise.resolve(true));
  const edit = useCallback(
    (
      id: string,
      label: string,
      fn: (bytes: Uint8Array) => Promise<Uint8Array>,
      opts: EditOptions = {},
    ): Promise<boolean> => {
      const run = async () => {
        const h = histories.current.get(id);
        const doc = core?.documents[id]?.document;
        if (!h) return false;
        if (doc?.isEncrypted) {
          toast(
            "This document is password-protected. Page changes need an unprotected copy.",
            "error",
          );
          return false;
        }
        setBusy(label);
        try {
          const next = await fn(h.current);
          h.push(next, label);
          if (h.trimmed) {
            toast("Undo history is full; the oldest steps for this document were dropped.");
            h.trimmed = false;
          }
          showRevision(id, next, opts.page ?? null);
          historyChanged();
          return true;
        } catch (e) {
          toast(`${label} failed: ${e instanceof Error ? e.message : String(e)}`, "error");
          return false;
        } finally {
          setBusy(null);
        }
      };
      editChain.current = editChain.current.then(run, run);
      return editChain.current;
    },
    [core, historyChanged, showRevision, toast],
  );

  const undo = useCallback(
    (id: string) => {
      const h = histories.current.get(id);
      const label = h?.undoLabel;
      const bytes = h?.undo();
      if (!bytes) return;
      showRevision(id, bytes, null);
      historyChanged();
      toast(`Undid: ${label}`);
    },
    [historyChanged, showRevision, toast],
  );

  const redo = useCallback(
    (id: string) => {
      const h = histories.current.get(id);
      const label = h?.redoLabel;
      const bytes = h?.redo();
      if (!bytes) return;
      showRevision(id, bytes, null);
      historyChanged();
      toast(`Redid: ${label}`);
    },
    [historyChanged, showRevision, toast],
  );

  const saveAs = useCallback(
    async (id: string): Promise<boolean> => {
      const m = metaRef.current[id];
      const h = histories.current.get(id);
      if (!m || !h) return false;
      const source = m.source.kind === "path" ? m.source.path : null;
      const target = await platform.pickSavePath(source ?? m.name);
      if (!target) return false;
      if (source && samePath(target, source)) {
        toast("Choose a new file name, or use Save (Ctrl+S) to update this file.", "error");
        return false;
      }
      try {
        await platform.saveAs(target, source, h.current);
      } catch (e) {
        const err = e instanceof PlatformError ? e : new PlatformError("other", String(e));
        toast(`Could not save: ${describeOpenError(err)}`, "error");
        return false;
      }
      h.markSaved();
      const name = baseName(target);
      metaRef.current = {
        ...metaRef.current,
        [id]: { ...m, source: { kind: "path", path: target }, name },
      };
      setMeta(metaRef.current);
      updateSettings({ recent: addRecent(settingsRef.current.recent, target) });
      historyChanged();
      toast(`Saved as ${name}.`);
      return true;
    },
    [historyChanged, toast, updateSettings],
  );

  const save = useCallback(
    async (id: string): Promise<boolean> => {
      const m = metaRef.current[id];
      const h = histories.current.get(id);
      if (!m || !h) return false;
      if (m.source.kind !== "path") return saveAs(id);
      try {
        await platform.save(m.source.path, h.current);
      } catch (e) {
        const err = e instanceof PlatformError ? e : new PlatformError("other", String(e));
        toast(`Could not save: ${describeOpenError(err)} Try Save As.`, "error");
        return false;
      }
      h.markSaved();
      historyChanged();
      toast(`Saved ${m.name}. The previous version is kept as ${m.name}.bak until it next opens.`);
      return true;
    },
    [historyChanged, saveAs, toast],
  );

  const openNew = useCallback(
    (name: string, bytes: Uint8Array) => {
      if (!docs) return;
      const documentId = crypto.randomUUID();
      metaRef.current = {
        ...metaRef.current,
        [documentId]: {
          source: { kind: "memory", name },
          name,
          fileSize: bytes.byteLength,
          pdfVersion: pdfHeaderVersion(bytes.subarray(0, 1024)),
          linearized: false,
          openStartedAt: performance.now(),
          organize: false,
        },
      };
      setMeta(metaRef.current);
      histories.current.set(documentId, new EditHistory(bytes, undefined, false));
      docs.openDocumentBuffer({
        buffer: bytes.slice().buffer,
        name,
        documentId,
        autoActivate: true,
      });
      historyChanged();
    },
    [docs, historyChanged],
  );

  const setSelectedBookmark = useCallback((id: string, path: number[] | null) => {
    const m = metaRef.current[id];
    if (!m) return;
    metaRef.current = { ...metaRef.current, [id]: { ...m, bookmark: path } };
    setMeta(metaRef.current);
  }, []);

  const setOrganize = useCallback((id: string, on: boolean, page?: number) => {
    const m = metaRef.current[id];
    if (!m) return;
    if (page !== undefined) restorePages.current.set(id, page);
    metaRef.current = { ...metaRef.current, [id]: { ...m, organize: on } };
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

  const api = useMemo<WorkbenchApi>(
    () => ({
      engine,
      settings,
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
      editState,
      edit,
      undo,
      redo,
      save,
      saveAs,
      openNew,
      setOrganize,
      setSelectedBookmark,
      forceClose,
      busy,
      restorePage,
      clearRestorePage,
    }),
    [
      engine,
      settings,
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
      editState,
      edit,
      undo,
      redo,
      save,
      saveAs,
      openNew,
      setOrganize,
      setSelectedBookmark,
      forceClose,
      busy,
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
