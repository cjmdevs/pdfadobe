// The stamp waiting to be placed (Phase 3): picked in the Stamps dialog, placed by a
// click on a page (StampLayer). Shared by both through this tiny store.
import { useSyncExternalStore } from "react";
import { PdfAnnotationName, type ImageMimeType } from "@embedpdf/models";
import { drawTextStamp, dynamicText, stampTitle, type TextStampDef } from "../../engine/stamps";

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

/** The standard stamp /Name PDFium writes for a built-in, or Custom. */
const nameOf = (def: TextStampDef): PdfAnnotationName =>
  (def.pdfName && PdfAnnotationName[def.pdfName as keyof typeof PdfAnnotationName]) ||
  PdfAnnotationName.Custom;

const exact = (u: Uint8Array) =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export async function textStamp(def: TextStampDef, author: string): Promise<PendingStamp> {
  const sample = await drawTextStamp(def, dynamicText(def, author, new Date()));
  return {
    subject: stampTitle(def),
    name: nameOf(def),
    width: sample.width,
    height: sample.height,
    make: async (who) => {
      const art = await drawTextStamp(def, dynamicText(def, who, new Date()));
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

/** The picture on the clipboard (PNG, or JPEG), or null when there is none. */
export async function clipboardImage(): Promise<{
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
} | null> {
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((t) => t === "image/png" || t === "image/jpeg");
    if (!type) continue;
    const bytes = new Uint8Array(await (await item.getType(type)).arrayBuffer());
    return { bytes, mime: type };
  }
  return null;
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
