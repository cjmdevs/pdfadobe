// Redaction marks waiting for review (Phase 5). The marks themselves are standard
// /Redact annotations in the document (visible in Acrobat, saved with the file); this
// store only holds what the review panel adds: which marks were accepted, where each
// came from and, for search hits, the text found. Memory only: never saved or logged.
import { useSyncExternalStore } from "react";
import { DEFAULT_OVERLAY, type MarkSource, type OverlayOptions } from "../../engine/redact";

/** Interaction mode while drawing redaction boxes (RedactLayer). */
export const REDACT_MODE = "redactArea";

export interface MarkInfo {
  source: MarkSource | "selection" | "page";
  /** Text the search found (never logged, never saved). */
  text?: string;
}

interface DocMarks {
  accepted: Set<string>;
  info: Map<string, MarkInfo>;
}

const docs = new Map<string, DocMarks>();
let overlay: OverlayOptions = { ...DEFAULT_OVERLAY };
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version++;
  for (const l of listeners) l();
}

function doc(id: string): DocMarks {
  let d = docs.get(id);
  if (!d) {
    d = { accepted: new Set(), info: new Map() };
    docs.set(id, d);
  }
  return d;
}

export const redactMarks = {
  accepted: (docId: string, markId: string) => doc(docId).accepted.has(markId),
  setAccepted(docId: string, markIds: string[], on: boolean) {
    const a = doc(docId).accepted;
    for (const m of markIds) {
      if (on) a.add(m);
      else a.delete(m);
    }
    changed();
  },
  info: (docId: string, markId: string): MarkInfo | undefined => doc(docId).info.get(markId),
  setInfo(docId: string, markId: string, info: MarkInfo) {
    doc(docId).info.set(markId, info);
    changed();
  },
  forget(docId: string, markIds: string[]) {
    const d = doc(docId);
    for (const m of markIds) {
      d.accepted.delete(m);
      d.info.delete(m);
    }
    changed();
  },
  overlay: () => overlay,
  setOverlay(o: Partial<OverlayOptions>) {
    overlay = { ...overlay, ...o };
    changed();
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Re-renders on any change to marks' review state or the overlay options. */
export function useRedactVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}
