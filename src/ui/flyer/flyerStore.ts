// What the Workpaper Tools place next (Phase 4): the armed tickmark stays armed, so each
// click on a page places another until Esc; a legend box is placed once. Shared by the
// page layers, the palette and the toolbar through this tiny store.
import { useSyncExternalStore } from "react";
import type { StampDrawing } from "../../engine/stamps";
import type { TickmarkDef } from "../../engine/flyer/tickmarks";
import type { StampTemplate } from "../../engine/flyer/userStamps";
import type { ConnectorStyle } from "../../flyer/connectors";

/** Interaction mode while a workpaper item waits for its click (FlyerLayer). */
export const FLYER_MODE = "workpaperPlace";

export type PendingItem =
  /** `label`: the letter or number of a letter/number tickmark (same at every click). */
  | { kind: "tickmark"; def: TickmarkDef; label?: string; width: number; height: number }
  | { kind: "legend"; art: StampDrawing; width: number; height: number }
  /** User/status stamp: reference and custom fields were asked for when it was picked;
   * name and time are filled in at each click. */
  | {
      kind: "stamp";
      template: StampTemplate;
      ref: string;
      fields: Record<string, string>;
      width: number;
      height: number;
    }
  /** Connector: first click sets the start (connectorStart), second the end. */
  | { kind: "connector"; style: ConnectorStyle; width: 0; height: 0 }
  /** Calculator: a click on an amount sends it (Shift: subtract). */
  | { kind: "pick"; width: 0; height: 0 }
  /** Foot/cross-foot: drag around a column or row of amounts, then click the total. */
  | { kind: "foot"; width: 0; height: 0 }
  /** Calculator tape waiting to be placed (once). */
  | { kind: "tape"; width: number; height: number };

let pending: PendingItem | null = null;
const listeners = new Set<() => void>();

export const flyerPlacement = {
  get: () => pending,
  set(p: PendingItem | null) {
    pending = p;
    connectorStart = null;
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

export interface ConnectorStart {
  documentId: string;
  pageIndex: number;
  x: number;
  y: number;
  /** Annotation (/NM) the start is attached to. */
  attachId: string | null;
}

/** First end of the connector being drawn (cleared with the pending item). */
let connectorStart: ConnectorStart | null = null;

export const connectorStartStore = {
  get: () => connectorStart,
  set(s: ConnectorStart | null) {
    connectorStart = s;
    for (const l of listeners) l();
  },
};

export function useConnectorStart(): ConnectorStart | null {
  return useSyncExternalStore(flyerPlacement.subscribe, connectorStartStore.get);
}

/** Last sequence number placed per document and tickmark, so quick clicks never repeat
 * a value before the annotation list catches up. */
export const lastSequence = new Map<string, number>();
