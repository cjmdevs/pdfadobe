// The stamp waiting to be placed (Phase 3): picked in the Stamps dialog, placed by a
// click on a page (StampLayer). Shared by both through this tiny store.
import { useSyncExternalStore } from "react";
import { PdfAnnotationName, type ImageMimeType } from "@embedpdf/models";
import { drawTextStamp, stampDetail, type TextStampDef } from "../../engine/stamps";

export interface StampArt {
  data: ArrayBuffer;
  mime: ImageMimeType;
  width: number;
  height: number;
}

export interface PendingStamp {
  /** Shown in the comments list ("Approved", or the custom stamp's name). */
  subject: string;
  name: PdfAnnotationName;
  /** Size of the outline that follows the pointer (page points). */
  width: number;
  height: number;
  /** The stamp's appearance, made when it is placed (built-ins carry the time). */
  make(author: string): Promise<StampArt>;
}

/** Stamp /Name per built-in (PDFium writes these names; Reviewed has no standard one). */
const NAMES: Record<string, PdfAnnotationName> = {
  approved: PdfAnnotationName.Approved,
  reviewed: PdfAnnotationName.Custom,
  draft: PdfAnnotationName.Draft,
  confidential: PdfAnnotationName.Confidential,
};

const exact = (u: Uint8Array) =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export async function textStamp(def: TextStampDef, author: string): Promise<PendingStamp> {
  const sample = await drawTextStamp(def, stampDetail(author, new Date()));
  return {
    subject: def.title.charAt(0) + def.title.slice(1).toLowerCase(),
    name: NAMES[def.id] ?? PdfAnnotationName.Custom,
    width: sample.width,
    height: sample.height,
    make: async (who) => {
      const art = await drawTextStamp(def, stampDetail(who, new Date()));
      return {
        data: exact(art.pdf),
        mime: "application/pdf",
        width: art.width,
        height: art.height,
      };
    },
  };
}

/** Largest size an image stamp is placed at (points); it keeps its proportions. */
const IMAGE_BOX = { width: 200, height: 120 };

export async function imageStamp(
  subject: string,
  bytes: Uint8Array,
  mime: "image/png" | "image/jpeg",
): Promise<PendingStamp> {
  const bitmap = await createImageBitmap(new Blob([exact(bytes)], { type: mime }));
  // Pixels as points (72 dpi), shrunk to fit the box.
  const k = Math.min(1, IMAGE_BOX.width / bitmap.width, IMAGE_BOX.height / bitmap.height);
  const width = Math.max(8, bitmap.width * k);
  const height = Math.max(8, bitmap.height * k);
  bitmap.close();
  const data = exact(bytes);
  return {
    subject,
    name: PdfAnnotationName.Image,
    width,
    height,
    make: async () => ({ data, mime, width, height }),
  };
}

let pending: PendingStamp | null = null;
const listeners = new Set<() => void>();

export const stampPlacement = {
  get: () => pending,
  set(s: PendingStamp | null) {
    pending = s;
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export function usePendingStamp(): PendingStamp | null {
  return useSyncExternalStore(stampPlacement.subscribe, stampPlacement.get);
}
