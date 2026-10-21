// The document pane for one tab: loading / error states, then the page viewer.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  DocumentContent,
  useDocumentManagerCapability,
} from "@embedpdf/plugin-document-manager/react";
import type { DocumentState } from "@embedpdf/core";
import {
  GlobalPointerProvider,
  PagePointerProvider,
} from "@embedpdf/plugin-interaction-manager/react";
import { RenderLayer } from "@embedpdf/plugin-render/react";
import { Rotate } from "@embedpdf/plugin-rotate/react";
import { Scroller, useScroll } from "@embedpdf/plugin-scroll/react";
import { SearchLayer, useSearch } from "@embedpdf/plugin-search/react";
import { SelectionLayer } from "@embedpdf/plugin-selection/react";
import { SpreadMode, useSpread } from "@embedpdf/plugin-spread/react";
import { TilingLayer } from "@embedpdf/plugin-tiling/react";
import { Viewport, useViewportCapability } from "@embedpdf/plugin-viewport/react";
import { ZoomMode } from "@embedpdf/plugin-zoom";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import { PdfErrorCode } from "@embedpdf/models";
import { useWorkbench } from "../app/workbench";

export function DocumentView({ documentId }: { documentId: string }) {
  return (
    <DocumentContent documentId={documentId}>
      {({ documentState, isLoading, isError, isLoaded }) => (
        <>
          {isLoading && (
            <div className="center-message" role="status">
              Opening…
            </div>
          )}
          {isError && <OpenFailure state={documentState} />}
          {isLoaded && <Viewer documentId={documentId} />}
        </>
      )}
    </DocumentContent>
  );
}

/** Documents that already got the remembered zoom (tab switches keep their own zoom). */
const zoomApplied = new Set<string>();

function Viewer({ documentId }: { documentId: string }) {
  const { settings, singlePage, setSinglePage } = useWorkbench();
  const { provides: zoom } = useZoom(documentId);

  // New documents open at the last zoom used (EmbedPDF would start numeric zooms at 1).
  // The zoom plugin ignores requests until the viewport has a size, so wait for it.
  const { provides: viewport } = useViewportCapability();
  useEffect(() => {
    if (!zoom || !viewport || zoomApplied.has(documentId)) return;
    const z = settings.zoom;
    const level = z === "fit-page" ? ZoomMode.FitPage : z === "fit-width" ? ZoomMode.FitWidth : z;
    const scope = viewport.forDocument(documentId);
    const apply = () => {
      if (zoomApplied.has(documentId) || scope.getMetrics().clientWidth === 0) return false;
      zoomApplied.add(documentId);
      zoom.requestZoom(level);
      return true;
    };
    if (apply()) return;
    const off = scope.onViewportChange(() => {
      if (apply()) off();
    });
    return off;
    // Only on first show of this document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, viewport, documentId]);
  const { provides: spread } = useSpread(documentId);
  const { provides: scroll, state: scrollState } = useScroll(documentId);
  const { state: search } = useSearch(documentId);
  const single = settings.viewMode === "single";

  // Two-up: Odd = pages 1-2, 3-4…; Even = page 1 alone (cover), then 2-3, 4-5…
  useEffect(() => {
    if (!spread) return;
    const mode =
      settings.viewMode === "twoUp"
        ? settings.coverPage
          ? SpreadMode.Even
          : SpreadMode.Odd
        : SpreadMode.None;
    if (spread.getSpreadMode() !== mode) spread.setSpreadMode(mode);
  }, [spread, settings.viewMode, settings.coverPage]);

  // Switching modes keeps the reader on the same page.
  const lastScrollPage = useRef(scrollState.currentPage);
  useEffect(() => {
    if (!single) lastScrollPage.current = scrollState.currentPage;
  }, [single, scrollState.currentPage]);
  const prevSingle = useRef(single);
  useEffect(() => {
    if (single && !prevSingle.current) setSinglePage(documentId, lastScrollPage.current - 1);
    if (!single && prevSingle.current) {
      const target = (singlePage[documentId] ?? 0) + 1;
      // Wait one frame for the Scroller to lay out.
      requestAnimationFrame(() =>
        scroll?.scrollToPage({ pageNumber: target, behavior: "instant" }),
      );
    }
    prevSingle.current = single;
  }, [single, documentId, scroll, setSinglePage, singlePage]);

  // Follow the active search hit (first hit after a search, then F3 / clicks).
  const hit = search.results[search.activeResultIndex];
  useEffect(() => {
    if (!hit) return;
    if (single) {
      setSinglePage(documentId, hit.pageIndex);
      return;
    }
    const r = hit.rects[0];
    scroll?.scrollToPage({
      pageNumber: hit.pageIndex + 1,
      ...(r ? { pageCoordinates: { x: r.origin.x, y: r.origin.y } } : {}),
      behavior: "instant",
      alignY: 30,
    });
  }, [single, hit, documentId, setSinglePage, scroll]);

  return (
    <GlobalPointerProvider documentId={documentId} style={{ height: "100%" }}>
      <Viewport documentId={documentId} className="viewport" data-testid="viewport" tabIndex={-1}>
        {single ? (
          <div className="single-page">
            <PageLayers
              documentId={documentId}
              pageIndex={singlePage[documentId] ?? 0}
              tiled={false}
            />
          </div>
        ) : (
          <Scroller
            documentId={documentId}
            renderPage={(layout) => (
              <PageLayers documentId={documentId} pageIndex={layout.pageIndex} tiled />
            )}
          />
        )}
      </Viewport>
    </GlobalPointerProvider>
  );
}

const noPointer: CSSProperties = { pointerEvents: "none" };

/**
 * One page. A cheap low-resolution render sits underneath so a page is never blank while
 * the sharp tiles for the current zoom are drawn on top (CLAUDE.md perf target).
 * Single Page mode skips tiling (tiles are positioned against the scroll layout) and
 * renders the whole page at full resolution instead.
 */
function PageLayers({
  documentId,
  pageIndex,
  tiled,
}: {
  documentId: string;
  pageIndex: number;
  tiled: boolean;
}) {
  return (
    <Rotate
      documentId={documentId}
      pageIndex={pageIndex}
      className="page"
      data-testid="page"
      data-page-index={pageIndex}
      style={{ backgroundColor: "#fff" }}
    >
      <PagePointerProvider documentId={documentId} pageIndex={pageIndex}>
        {tiled ? (
          <>
            <RenderLayer
              documentId={documentId}
              pageIndex={pageIndex}
              scale={0.5}
              style={noPointer}
            />
            <TilingLayer documentId={documentId} pageIndex={pageIndex} style={noPointer} />
          </>
        ) : (
          <RenderLayer documentId={documentId} pageIndex={pageIndex} style={noPointer} />
        )}
        <SearchLayer
          documentId={documentId}
          pageIndex={pageIndex}
          highlightColor="rgba(255, 213, 0, 0.45)"
          activeHighlightColor="rgba(255, 120, 0, 0.6)"
        />
        <SelectionLayer documentId={documentId} pageIndex={pageIndex} />
      </PagePointerProvider>
    </Rotate>
  );
}

function OpenFailure({ state }: { state: DocumentState }) {
  const { meta, closeDocument, repairCopy } = useWorkbench();
  const { provides: docs } = useDocumentManagerCapability();
  const m = meta[state.id];
  const name = m?.name ?? state.name ?? "This file";

  if (state.errorCode === PdfErrorCode.Password) {
    return (
      <PasswordPrompt
        name={name}
        retried={state.passwordProvided === true}
        onSubmit={(password) => docs?.retryDocument(state.id, { password })}
        onCancel={() => closeDocument(state.id)}
      />
    );
  }
  const canRepair = m?.source.kind === "path";
  return (
    <div className="center-message" role="alert" data-testid="open-failure">
      <h2>Can't open {name}</h2>
      <p>
        The file is damaged or is not a PDF. PDF Workbench can try to repair it and save the result
        as a new file. The original is not changed.
      </p>
      <div className="button-row">
        {canRepair && (
          <button type="button" className="primary" onClick={() => void repairCopy(state.id)}>
            Repair a copy…
          </button>
        )}
        <button type="button" onClick={() => closeDocument(state.id)}>
          Close
        </button>
      </div>
    </div>
  );
}

function PasswordPrompt({
  name,
  retried,
  onSubmit,
  onCancel,
}: {
  name: string;
  retried: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <form
      className="center-message"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password);
      }}
    >
      <h2>{name} is password protected</h2>
      {retried && (
        <p className="error-text" role="alert">
          That password is not correct.
        </p>
      )}
      <label>
        Password{" "}
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Document password"
        />
      </label>
      <div className="button-row">
        <button type="submit" className="primary">
          Open
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
