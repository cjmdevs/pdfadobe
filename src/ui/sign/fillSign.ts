// Fill & Sign (Phase 8): saved signatures and quick marks are armed as stamps (the
// Stamp tool's placement: an outline follows the pointer, a click places it, and it can
// then be moved and resized like any stamp).
import { useSyncExternalStore } from "react";
import { PdfAnnotationName } from "@embedpdf/models";
import type { WorkbenchApi } from "../../app/workbench";
import { platform, type SavedSignature } from "../../platform";
import {
  drawFillMark,
  drawSignatureMark,
  drawTextMark,
  fillDate,
  type FillMark,
} from "../../engine/sign/marks";
import type { PendingStamp } from "../markup/stampPlacement";
import type { StampDrawing } from "../../engine/stamps";
import { pngSize } from "./signatureArt";

const exact = (u: Uint8Array) =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

function fromDrawing(
  subject: string,
  draw: () => Promise<StampDrawing>,
  sample: StampDrawing,
): PendingStamp {
  return {
    subject,
    name: PdfAnnotationName.Custom,
    width: sample.width,
    height: sample.height,
    make: async () => {
      const d = await draw();
      return { data: exact(d.pdf), mime: "application/pdf", width: d.width, height: d.height };
    },
  };
}

const MARK_NAMES: Record<FillMark, string> = {
  check: "Check mark",
  cross: "Cross mark",
  dot: "Dot",
};

export async function markStamp(kind: FillMark): Promise<PendingStamp> {
  const draw = () => drawFillMark(kind);
  return fromDrawing(MARK_NAMES[kind], draw, await draw());
}

export async function dateStamp(): Promise<PendingStamp> {
  const draw = () => drawTextMark(fillDate(new Date()));
  return fromDrawing("Date", draw, await draw());
}

/** Largest size a signature is placed at (points); it keeps its proportions. */
const BOX = { signature: { w: 180, h: 54 }, initials: { w: 72, h: 40 } };

export async function signatureStamp(
  sig: SavedSignature,
  withDate: boolean,
): Promise<PendingStamp> {
  const png = await platform.signatures.read(sig.id);
  const px = pngSize(png);
  const box = BOX[sig.kind];
  const k = Math.min(box.w / px.width, box.h / px.height);
  const w = Math.max(8, px.width * k);
  const h = Math.max(8, px.height * k);
  const draw = () => drawSignatureMark(png, w, h, withDate ? fillDate(new Date()) : undefined);
  return fromDrawing(sig.kind === "initials" ? "Initials" : "Signature", draw, await draw());
}

/** Saved signatures, loaded once and refreshed after changes. */
let saved: SavedSignature[] = [];
let loaded = false;
const listeners = new Set<() => void>();

export const savedSignatures = {
  get: () => saved,
  async refresh() {
    try {
      saved = await platform.signatures.list();
    } catch {
      saved = [];
    }
    loaded = true;
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    if (!loaded) void savedSignatures.refresh();
    return () => void listeners.delete(l);
  },
};

export function useSavedSignatures(): SavedSignature[] {
  return useSyncExternalStore(savedSignatures.subscribe, savedSignatures.get);
}

export function openSignatureDialog(
  wb: WorkbenchApi,
  kind: "signature" | "initials",
  documentId: string | null,
) {
  wb.setDialog({ kind: "signatures", create: kind, documentId });
}
