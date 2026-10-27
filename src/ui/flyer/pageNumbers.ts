// Amounts printed on a page (Phase 4 stage 3), read once per page in the page-engine
// worker from the store's bytes and kept for the life of the document id (a page edit
// reopens the tab under a new id). Rects in page points, top-left origin like EmbedPDF.
import type { Rect } from "@embedpdf/models";
import { pageOp } from "../../app/pages";
import type { WorkbenchApi } from "../../app/workbench";

export interface ShownNumber {
  text: string;
  value: number;
  rect: Rect;
}

const cache = new Map<string, Promise<ShownNumber[]>>();

export function numbersOn(
  wb: WorkbenchApi,
  documentId: string,
  pageIndex: number,
): Promise<ShownNumber[]> {
  const key = `${documentId}:${pageIndex}`;
  let p = cache.get(key);
  if (!p) {
    p = wb.contentBytes(documentId).then(async (bytes) => {
      if (!bytes) return [];
      const { height, numbers } = await pageOp("pageNumbers", bytes, pageIndex);
      return numbers.map((n) => ({
        text: n.text,
        value: n.value,
        rect: {
          origin: { x: n.rect.l, y: height - n.rect.t },
          size: { width: n.rect.r - n.rect.l, height: n.rect.t - n.rect.b },
        },
      }));
    });
    // A failure is not kept: the next click asks again.
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** The amount under a point (a little slack around it), or null. */
export function numberAt(list: ShownNumber[], x: number, y: number): ShownNumber | null {
  const slack = 2;
  return (
    list.find(
      (n) =>
        x >= n.rect.origin.x - slack &&
        x <= n.rect.origin.x + n.rect.size.width + slack &&
        y >= n.rect.origin.y - slack &&
        y <= n.rect.origin.y + n.rect.size.height + slack,
    ) ?? null
  );
}

/** Amounts whose centre is inside `r`. */
export function numbersIn(list: ShownNumber[], r: Rect): ShownNumber[] {
  return list.filter((n) => {
    const cx = n.rect.origin.x + n.rect.size.width / 2;
    const cy = n.rect.origin.y + n.rect.size.height / 2;
    return (
      cx >= r.origin.x &&
      cx <= r.origin.x + r.size.width &&
      cy >= r.origin.y &&
      cy <= r.origin.y + r.size.height
    );
  });
}
