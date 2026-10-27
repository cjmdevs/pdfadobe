// What the Workpaper Tools place next (Phase 4): the armed tickmark stays armed, so each
// click on a page places another until Esc; a legend box is placed once. Shared by the
// page layers, the palette and the toolbar through this tiny store.
import { useSyncExternalStore } from "react";
import type { StampDrawing } from "../../engine/stamps";
import type { TickmarkDef } from "../../engine/flyer/tickmarks";

/** Interaction mode while a workpaper item waits for its click (FlyerLayer). */
export const FLYER_MODE = "workpaperPlace";

export type PendingItem =
  | { kind: "tickmark"; def: TickmarkDef; width: number; height: number }
  | { kind: "legend"; art: StampDrawing; width: number; height: number };

let pending: PendingItem | null = null;
const listeners = new Set<() => void>();

export const flyerPlacement = {
  get: () => pending,
  set(p: PendingItem | null) {
    pending = p;
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export function usePendingItem(): PendingItem | null {
  return useSyncExternalStore(flyerPlacement.subscribe, flyerPlacement.get);
}

/** Last sequence number placed per document and tickmark, so quick clicks never repeat
 * a value before the annotation list catches up. */
export const lastSequence = new Map<string, number>();
