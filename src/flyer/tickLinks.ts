// Matching letter/number tickmarks link to each other (owner request 2026-10-27): every
// circled "A" in a document has a /Link over it that goes to the next "A" (page order,
// the last one back to the first), so a click in Acrobat walks through them. Our app
// keeps the links in step as tickmarks are added, moved or deleted. Node-safe.

import {
  PdfAnnotationSubtype,
  PdfZoomMode,
  type PdfAnnotationObject,
  type PdfLinkAnnoObject,
} from "@embedpdf/models";
import { pwData } from "./items";

/** Tickmarks of one letter/number tickmark with the same value, in page order. */
export function linkGroups(annots: PdfAnnotationObject[]): Map<string, PdfAnnotationObject[]> {
  const groups = new Map<string, PdfAnnotationObject[]>();
  for (const a of annots) {
    const d = pwData(a);
    if (d?.pwType !== "Tickmark" || !d.pwLink || !d.pwLabel) continue;
    const key = `${d.pwTick ?? ""}:${d.pwLabel}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  for (const list of groups.values())
    list.sort(
      (p, q) =>
        p.pageIndex - q.pageIndex ||
        p.rect.origin.y - q.rect.origin.y ||
        p.rect.origin.x - q.rect.origin.x,
    );
  return groups;
}

/** The tickmark after `a` in its group, or null when it is the only one. */
export function nextLinked(
  annots: PdfAnnotationObject[],
  a: PdfAnnotationObject,
): PdfAnnotationObject | null {
  for (const list of linkGroups(annots).values()) {
    const i = list.findIndex((m) => m.id === a.id);
    if (i >= 0) return list.length > 1 ? (list[(i + 1) % list.length] ?? null) : null;
  }
  return null;
}

/**
 * Links to add and remove so every grouped tickmark has exactly one link, over it, to
 * the next one. `pageHeight` turns the target into PDF space for the destination.
 */
export function tickLinkChanges(
  annots: PdfAnnotationObject[],
  pageHeight: (pageIndex: number) => number,
): { create: PdfLinkAnnoObject[]; remove: { pageIndex: number; id: string }[] } {
  const want = new Map<string, { of: PdfAnnotationObject; next: PdfAnnotationObject }>();
  for (const list of linkGroups(annots).values()) {
    if (list.length < 2) continue;
    list.forEach((of, i) => {
      const next = list[(i + 1) % list.length];
      if (next) want.set(of.id, { of, next });
    });
  }
  const remove: { pageIndex: number; id: string }[] = [];
  const have = new Set<string>();
  for (const a of annots) {
    const d = pwData(a);
    if (d?.pwType !== "TickLink") continue;
    const w = d.pwOf ? want.get(d.pwOf) : undefined;
    const same =
      w &&
      !have.has(w.of.id) &&
      d.pwNext === w.next.id &&
      a.pageIndex === w.of.pageIndex &&
      Math.abs(a.rect.origin.x - w.of.rect.origin.x) < 0.5 &&
      Math.abs(a.rect.origin.y - w.of.rect.origin.y) < 0.5 &&
      // The target moves with the next tickmark; a moved target means a new link.
      d.pwAt ===
        `${w.next.pageIndex}:${Math.round(w.next.rect.origin.x)}:${Math.round(w.next.rect.origin.y)}`;
    if (same && w) have.add(w.of.id);
    else remove.push({ pageIndex: a.pageIndex, id: a.id });
  }
  const create: PdfLinkAnnoObject[] = [];
  for (const { of, next } of want.values()) {
    if (have.has(of.id)) continue;
    const at = `${next.pageIndex}:${Math.round(next.rect.origin.x)}:${Math.round(next.rect.origin.y)}`;
    create.push({
      type: PdfAnnotationSubtype.LINK,
      id: crypto.randomUUID(),
      pageIndex: of.pageIndex,
      rect: of.rect,
      strokeWidth: 0,
      // Belongs to the tickmark (/IRT): EmbedPDF lets clicks through to the tickmark (so it
      // can still be selected and moved) and deletes the link with it.
      inReplyToId: of.id,
      target: {
        type: "destination",
        destination: {
          pageIndex: next.pageIndex,
          // PDF space (bottom-left origin); zoom 0 keeps the reader's zoom.
          zoom: {
            mode: PdfZoomMode.XYZ,
            params: {
              x: Math.max(0, next.rect.origin.x - 72),
              y: pageHeight(next.pageIndex) - Math.max(0, next.rect.origin.y - 72),
              zoom: 0,
            },
          },
          view: [],
        },
      },
      custom: { pwType: "TickLink", pwOf: of.id, pwNext: next.id, pwAt: at },
    });
  }
  return { create, remove };
}

/** PDFlyer's letter and number tickmark categories (owner's sample): the same Subject,
 * "Letter Connectors:C" or "Connectors:2", means the same mark. Ours use them too (B6). */
const MATCH = /^(Letter Connectors|Connectors):\s*(.+)$/;

/** Every letter/number tickmark with the same value as `a` (PDFlyer's or ours), in page
 * order; empty when `a` is not one. */
export function matchingTickmarks(
  annots: PdfAnnotationObject[],
  a: PdfAnnotationObject,
): PdfAnnotationObject[] {
  const key = (x: PdfAnnotationObject) => {
    if (x.type !== PdfAnnotationSubtype.STAMP) return null;
    const m = MATCH.exec((x as { subject?: string }).subject?.trim() ?? "");
    return m ? `${m[1]}:${m[2]}` : null;
  };
  const k = key(a);
  if (!k) return [];
  return annots
    .filter((x) => key(x) === k)
    .sort(
      (p, q) =>
        p.pageIndex - q.pageIndex ||
        p.rect.origin.y - q.rect.origin.y ||
        p.rect.origin.x - q.rect.origin.x,
    );
}

/** The value a matching tickmark shows ("C", "2"), from its Subject. */
export function matchLabel(a: PdfAnnotationObject): string | null {
  return MATCH.exec((a as { subject?: string }).subject?.trim() ?? "")?.[2] ?? null;
}
