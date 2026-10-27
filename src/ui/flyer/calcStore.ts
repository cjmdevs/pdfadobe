// The calculator's state (Phase 4 stage 3), shared by the calculator panel and the page
// layers (click a number, foot/cross-foot). One calculator for the whole window, like a
// desk calculator; its tape is placed on whichever page the user clicks.
import { useSyncExternalStore } from "react";
import type { Rect } from "@embedpdf/models";
import { EMPTY_CALC, type CalcState, type FootResult } from "../../flyer/calc";

export interface Footing {
  documentId: string;
  pageIndex: number;
  /** "total": waiting for the total to be clicked; "done": result shown. */
  stage: "total" | "done";
  values: number[];
  /** Selected amounts, page points (top-left origin), for the highlight. */
  rects: Rect[];
  across: boolean;
  result: FootResult | null;
  /** The total that was clicked (for "Mark total"). */
  totalRect: Rect | null;
}

export interface CalcView {
  calc: CalcState;
  footing: Footing | null;
  /** The tape annotation being edited (Update tape replaces it). */
  editing: { documentId: string; pageIndex: number; id: string; rect: Rect } | null;
}

let view: CalcView = { calc: EMPTY_CALC, footing: null, editing: null };
const listeners = new Set<() => void>();

export const calcStore = {
  get: () => view,
  set(patch: Partial<CalcView>) {
    view = { ...view, ...patch };
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export function useCalcView(): CalcView {
  return useSyncExternalStore(calcStore.subscribe, calcStore.get);
}
