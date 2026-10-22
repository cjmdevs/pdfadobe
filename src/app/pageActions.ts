// Page operations as the UI calls them: each runs in the page-engine worker through
// Workbench.edit (one undoable step) or opens its result as a new tab. The pages an
// operation worked on stay selected in the Organize grid afterwards, so the next button
// (e.g. a second Rotate) acts on the same pages.
import { useMemo } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { moveOrder, titleFromFileName, type Margins, type QuarterTurns } from "../engine/pages";
import { formatRanges } from "../engine/pages/ranges";
import { pageOp } from "./pages";
import { useWorkbench } from "./workbench";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

export function usePageActions(documentId: string) {
  const wb = useWorkbench();
  const pageCount = useDocumentState(documentId)?.document?.pageCount ?? 0;
  return useMemo(() => {
    const name = wb.meta[documentId]?.name ?? "Document.pdf";
    const run = (
      label: string,
      fn: (b: Uint8Array) => Promise<Uint8Array>,
      page: number | undefined,
      select: number[],
    ) => wb.edit(documentId, label, fn, page === undefined ? { select } : { page, select });
    return {
      rotate: (pages: number[], turns: QuarterTurns) =>
        run(
          turns === 3 ? "Rotate left" : turns === 1 ? "Rotate right" : "Rotate 180°",
          (b) => pageOp("rotatePages", b, pages, turns),
          pages[0],
          pages,
        ),
      remove: (pages: number[]) => {
        const page = Math.max(0, Math.min(...pages) - 1);
        return run(
          `Delete ${plural(pages.length, "page")}`,
          (b) => pageOp("deletePages", b, pages),
          page,
          [page],
        );
      },
      duplicate: (pages: number[]) =>
        run(
          `Duplicate ${plural(pages.length, "page")}`,
          (b) => pageOp("duplicatePages", b, pages),
          Math.max(...pages) + 1,
          pages,
        ),
      /** Pages (in the given order) go before old page `before`; null = to the end. */
      move: (pages: number[], before: number | null) => {
        const order = moveOrder(pageCount, pages, before);
        const moved = pages.map((p) => order.indexOf(p));
        return run(
          `Move ${plural(pages.length, "page")}`,
          (b) => pageOp("movePages", b, pages, before),
          moved[0],
          moved,
        );
      },
      insertBlank: (at: number, count = 1, size?: { width: number; height: number }) =>
        run(
          `Insert ${plural(count, "blank page")}`,
          (b) => pageOp("insertBlankPages", b, at, count, size),
          at,
          range(at, count),
        ),
      crop: (pages: number[], margins: Margins) =>
        run(
          `Crop ${plural(pages.length, "page")}`,
          (b) => pageOp("cropPages", b, pages, margins),
          pages[0],
          pages,
        ),
      setSize: (pages: number[], size: { width: number; height: number }) =>
        run(
          `Set page size (${plural(pages.length, "page")})`,
          (b) => pageOp("setPageSize", b, pages, size),
          pages[0],
          pages,
        ),
      insertFrom: (other: Uint8Array, otherPages: number[], at: number) =>
        run(
          `Insert ${plural(otherPages.length, "page")}`,
          (b) => pageOp("insertPages", b, other, otherPages, at),
          at,
          range(at, otherPages.length),
        ),
      replace: (targets: number[], other: Uint8Array, otherPages: number[]) =>
        run(
          `Replace ${plural(targets.length, "page")}`,
          (b) => pageOp("replacePages", b, targets, other, otherPages),
          targets[0],
          targets,
        ),
      /** Selected pages as a new, unsaved document in a new tab. */
      extract: async (pages: number[]) => {
        const bytes = wb.docBytes(documentId);
        if (!bytes) return;
        try {
          const out = await pageOp("extractPages", bytes, pages);
          wb.openNew(
            `${titleFromFileName(name)} (pages ${formatRanges([...pages].sort((a, b) => a - b))}).pdf`,
            out,
          );
        } catch (e) {
          wb.toast(`Extract failed: ${e instanceof Error ? e.message : String(e)}`, "error");
        }
      },
    };
  }, [wb, documentId, pageCount]);
}

export type PageActions = ReturnType<typeof usePageActions>;
