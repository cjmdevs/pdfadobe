// Page operations as the UI calls them: each runs in the page-engine worker through
// Workbench.edit (one undoable step) or opens its result as a new tab.
import { useMemo } from "react";
import { titleFromFileName, type Margins, type QuarterTurns } from "../engine/pages";
import { formatRanges } from "../engine/pages/ranges";
import { pageOp } from "./pages";
import { useWorkbench } from "./workbench";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function usePageActions(documentId: string) {
  const wb = useWorkbench();
  return useMemo(() => {
    const name = wb.meta[documentId]?.name ?? "Document.pdf";
    const run = (label: string, fn: (b: Uint8Array) => Promise<Uint8Array>, page?: number) =>
      wb.edit(documentId, label, fn, page === undefined ? {} : { page });
    return {
      rotate: (pages: number[], turns: QuarterTurns) =>
        run(
          turns === 3 ? "Rotate left" : turns === 1 ? "Rotate right" : "Rotate 180°",
          (b) => pageOp("rotatePages", b, pages, turns),
          pages[0],
        ),
      remove: (pages: number[]) =>
        run(
          `Delete ${plural(pages.length, "page")}`,
          (b) => pageOp("deletePages", b, pages),
          Math.max(0, Math.min(...pages) - 1),
        ),
      duplicate: (pages: number[]) =>
        run(
          `Duplicate ${plural(pages.length, "page")}`,
          (b) => pageOp("duplicatePages", b, pages),
          Math.max(...pages) + 1,
        ),
      /** Pages (in the given order) go before old page `before`; null = to the end. */
      move: (pages: number[], before: number | null) =>
        run(`Move ${plural(pages.length, "page")}`, (b) => pageOp("movePages", b, pages, before)),
      insertBlank: (at: number, count = 1, size?: { width: number; height: number }) =>
        run(
          `Insert ${plural(count, "blank page")}`,
          (b) => pageOp("insertBlankPages", b, at, count, size),
          at,
        ),
      crop: (pages: number[], margins: Margins) =>
        run(
          `Crop ${plural(pages.length, "page")}`,
          (b) => pageOp("cropPages", b, pages, margins),
          pages[0],
        ),
      setSize: (pages: number[], size: { width: number; height: number }) =>
        run(
          `Set page size (${plural(pages.length, "page")})`,
          (b) => pageOp("setPageSize", b, pages, size),
          pages[0],
        ),
      insertFrom: (other: Uint8Array, otherPages: number[], at: number) =>
        run(
          `Insert ${plural(otherPages.length, "page")}`,
          (b) => pageOp("insertPages", b, other, otherPages, at),
          at,
        ),
      replace: (targets: number[], other: Uint8Array, otherPages: number[]) =>
        run(
          `Replace ${plural(targets.length, "page")}`,
          (b) => pageOp("replacePages", b, targets, other, otherPages),
          targets[0],
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
  }, [wb, documentId]);
}

export type PageActions = ReturnType<typeof usePageActions>;
