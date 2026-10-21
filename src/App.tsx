// Main window: tabs, toolbar, navigation pane, document, find panel.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/react";
import type { PdfEngine } from "@embedpdf/models";
import { AttachmentPluginPackage } from "@embedpdf/plugin-attachment/react";
import { BookmarkPluginPackage } from "@embedpdf/plugin-bookmark/react";
import {
  DocumentManagerPluginPackage,
  useActiveDocument,
} from "@embedpdf/plugin-document-manager/react";
import { InteractionManagerPluginPackage } from "@embedpdf/plugin-interaction-manager/react";
import { PrintFrame, PrintPluginPackage } from "@embedpdf/plugin-print/react";
import { RenderPluginPackage } from "@embedpdf/plugin-render/react";
import { RotatePluginPackage } from "@embedpdf/plugin-rotate/react";
import { ScrollPluginPackage, ScrollStrategy } from "@embedpdf/plugin-scroll/react";
import { SearchPluginPackage } from "@embedpdf/plugin-search/react";
import { CopyToClipboard, SelectionPluginPackage } from "@embedpdf/plugin-selection/react";
import { SpreadPluginPackage } from "@embedpdf/plugin-spread/react";
import { ThumbnailPluginPackage } from "@embedpdf/plugin-thumbnail/react";
import { TilingPluginPackage } from "@embedpdf/plugin-tiling/react";
import { ViewportPluginPackage } from "@embedpdf/plugin-viewport/react";
import { ZoomMode } from "@embedpdf/plugin-zoom";
import { ZoomPluginPackage } from "@embedpdf/plugin-zoom/react";
import { Commands, useLoadedDocumentId } from "./app/Commands";
import type { Settings } from "./app/settings";
import { WorkbenchProvider, useWorkbench } from "./app/workbench";
import { fileToOpened, platform } from "./platform";
import { DocumentView } from "./ui/DocumentView";
import { Dialogs } from "./ui/Dialogs";
import { SearchPanel } from "./ui/SearchPanel";
import { Sidebar } from "./ui/Sidebar";
import { StartPage, Toasts } from "./ui/StartPage";
import { Guard } from "./ui/Guard";
import { TabBar } from "./ui/TabBar";
import { Toolbar } from "./ui/Toolbar";

function plugins(settings: Settings) {
  const zoom =
    settings.zoom === "fit-page"
      ? ZoomMode.FitPage
      : settings.zoom === "fit-width"
        ? ZoomMode.FitWidth
        : settings.zoom;
  return [
    createPluginRegistration(DocumentManagerPluginPackage, { maxDocuments: 50 }),
    createPluginRegistration(ViewportPluginPackage, { viewportGap: 12 }),
    createPluginRegistration(ScrollPluginPackage, {
      defaultStrategy: ScrollStrategy.Vertical,
      defaultPageGap: 12,
    }),
    createPluginRegistration(RenderPluginPackage),
    // 768 px tiles with one extra ring pre-rendered: scrolling shows sharp pages sooner.
    createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 2.5, extraRings: 1 }),
    createPluginRegistration(ZoomPluginPackage, {
      defaultZoomLevel: zoom,
      minZoom: 0.1,
      maxZoom: 64 / 3,
    }),
    createPluginRegistration(RotatePluginPackage),
    createPluginRegistration(SpreadPluginPackage),
    createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(SelectionPluginPackage),
    createPluginRegistration(SearchPluginPackage),
    createPluginRegistration(ThumbnailPluginPackage, {
      width: 132,
      gap: 10,
      labelHeight: 18,
      buffer: 4,
    }),
    createPluginRegistration(BookmarkPluginPackage),
    createPluginRegistration(AttachmentPluginPackage),
    createPluginRegistration(PrintPluginPackage),
  ];
}

export default function App({ engine, settings }: { engine: PdfEngine; settings: Settings }) {
  // Plugins are configured once from the settings at startup.
  const registrations = useMemo(() => plugins(settings), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <EmbedPDF engine={engine} plugins={registrations}>
      {({ pluginsReady }) => (
        <WorkbenchProvider engine={engine} initialSettings={settings}>
          <Shell ready={pluginsReady} />
        </WorkbenchProvider>
      )}
    </EmbedPDF>
  );
}

function useResolvedTheme(theme: Settings["theme"]): "light" | "dark" {
  const query = "(prefers-color-scheme: dark)";
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

function Shell({ ready }: { ready: boolean }) {
  const wb = useWorkbench();
  const { activeDocumentId } = useActiveDocument();
  const loadedId = useLoadedDocumentId();
  const theme = useResolvedTheme(wb.settings.theme);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Startup: reopen last session's tabs, then anything passed on the command line.
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void (async () => {
      const { openTabs, activeTab } = wb.settings;
      const launch = await platform.takeLaunchPaths();
      await wb.openPaths(openTabs, { quiet: true });
      if (activeTab) wb.activatePath(activeTab);
      // Files from "Open with" come last so they end up active.
      await wb.openPaths(launch);
      document.documentElement.dataset.appReady = "true";
    })();
  }, [ready, wb]);

  // "Open with" while running (second instance) and native drag-drop from Explorer.
  useEffect(() => {
    const offs: Promise<() => void>[] = [
      platform.onOpenPaths((paths) => void wb.openPaths(paths)),
      platform.onFileDrop((paths) => void wb.openPaths(paths.filter((p) => /\.pdf$/i.test(p)))),
    ];
    return () => offs.forEach((p) => void p.then((off) => off()));
  }, [wb]);

  // Browser drag-drop (dev / tests). In the Windows app the native handler above gets
  // real paths instead, so the file can be remembered in Recent Files.
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf",
    );
    if (files.length) void Promise.all(files.map(fileToOpened)).then(wb.openFiles);
  };

  return (
    <div
      className={`app${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <TabBar />
      <Guard resetKey={loadedId} fallback={<Toolbar documentId={null} />}>
        <Toolbar documentId={loadedId} />
      </Guard>
      <main className="workspace">
        {loadedId && wb.settings.sidebarOpen && (
          <Guard resetKey={loadedId}>
            <Sidebar key={loadedId} documentId={loadedId} />
          </Guard>
        )}
        <section className="doc-area" aria-label="Document">
          {!ready ? (
            <div className="center-message" role="status">
              Starting…
            </div>
          ) : activeDocumentId ? (
            <Guard resetKey={activeDocumentId}>
              <DocumentView key={activeDocumentId} documentId={activeDocumentId} />
            </Guard>
          ) : (
            <StartPage />
          )}
        </section>
        {loadedId && wb.searchOpen && (
          <Guard resetKey={loadedId}>
            <SearchPanel key={loadedId} documentId={loadedId} />
          </Guard>
        )}
      </main>
      {dragging && <div className="drop-overlay">Drop PDF files to open them</div>}
      <Commands />
      <Dialogs />
      <Toasts />
      <CopyToClipboard />
      <PrintFrame />
    </div>
  );
}
