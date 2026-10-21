// App state that sits above the EmbedPDF plugins: which file each tab came from,
// settings persistence, dialogs, toasts, and the open / close / repair / print flows.

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
  platform,
  suffixedPath,
  type FileSource,
  type OpenedFile,
} from "../platform";
import { addRecent, removeRecent, samePath, type Settings } from "./settings";

export interface DocMeta {
  source: FileSource;
  name: string;
  fileSize: number;
  pdfVersion: string | null;
  linearized: boolean;
  /** performance.now() when the open started; used by the perf test. */
  openStartedAt: number;
}

export type Dialog =
  | { kind: "openError"; path: string; error: PlatformError }
  | { kind: "properties"; documentId: string }
  | { kind: "shortcuts" }
  | null;

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
  openFiles(files: OpenedFile[]): void;
  /** Switch to the tab showing `path`, if open. */
  activatePath(path: string): void;
  closeDocument(id: string): void;
  closeAll(): void;
  repairCopy(id: string): Promise<void>;
  print(id: string, currentPage: number): Promise<void>;
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
    (files: OpenedFile[]) => {
      if (!docs) return;
      for (const f of files) {
        if (f.source.kind === "path") {
          const path = f.source.path;
          const existing = Object.entries(metaRef.current).find(
            ([, m]) => m.source.kind === "path" && samePath(m.source.path, path),
          );
          if (existing) {
            docs.setActiveDocument(existing[0]);
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
        };
        metaRef.current = { ...metaRef.current, [documentId]: m };
        setMeta(metaRef.current);
        docs.openDocumentBuffer({ buffer: f.bytes, name: f.name, documentId, autoActivate: true });
      }
    },
    [docs],
  );

  const openPaths = useCallback(
    async (paths: string[], opts: { quiet?: boolean } = {}) => {
      for (const path of paths) {
        try {
          const file = await platform.readPath(path);
          openFiles([file]);
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

  const closeDocument = useCallback(
    (id: string) => {
      docs?.closeDocument(id);
      const rest = Object.fromEntries(Object.entries(metaRef.current).filter(([k]) => k !== id));
      metaRef.current = rest;
      setMeta(rest);
    },
    [docs],
  );

  const closeAll = useCallback(() => {
    docs?.closeAllDocuments();
    metaRef.current = {};
    setMeta({});
  }, [docs]);

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
