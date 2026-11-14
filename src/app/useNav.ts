// Page navigation that works the same in every view mode.
// Continuous / two-up use EmbedPDF's scroll plugin (1-based pages). Single Page mode
// renders one page itself, so its current page lives in the workbench (0-based).
import { useCallback, useRef } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { markJump } from "./viewHistory";
import { useWorkbench } from "./workbench";

export interface Nav {
  /** 0-based. */
  page: number;
  pageCount: number;
  goTo(index: number): void;
  next(): void;
  prev(): void;
  first(): void;
  last(): void;
}

export function useNav(documentId: string): Nav {
  const { settings, singlePage, setSinglePage } = useWorkbench();
  const { provides: scroll, state } = useScroll(documentId);
  const pageCount = useDocumentState(documentId)?.document?.pageCount ?? 0;
  const single = settings.viewMode === "single";
  const page = single ? (singlePage[documentId] ?? 0) : Math.max(0, state.currentPage - 1);
  /** goTo is a jump unless next/prev called it. */
  const jumpNext = useRef(true);

  const goTo = useCallback(
    (index: number) => {
      if (pageCount === 0) return;
      const i = Math.min(Math.max(0, Math.trunc(index)), pageCount - 1);
      // Page by page is not a jump for Previous view (B8); Go to, first, last are.
      if (Math.abs(i - page) > 1 || jumpNext.current) markJump();
      jumpNext.current = true;
      if (single) setSinglePage(documentId, i);
      else scroll?.scrollToPage({ pageNumber: i + 1, behavior: "instant" });
    },
    [documentId, pageCount, scroll, setSinglePage, single, page],
  );

  // In two-up mode a "page" step moves a whole spread, like Acrobat.
  const step = settings.viewMode === "twoUp" ? 2 : 1;
  const stepTo = (i: number) => {
    jumpNext.current = false;
    goTo(i);
  };
  return {
    page,
    pageCount,
    goTo,
    next: () => stepTo(page + step),
    prev: () => stepTo(page - step),
    first: () => goTo(0),
    last: () => goTo(pageCount - 1),
  };
}
