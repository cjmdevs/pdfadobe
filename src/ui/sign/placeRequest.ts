// A just-saved signature waiting to be armed on its document (the dialog has no access
// to the document's annotation tools; useDocToolContext picks the request up).
import { useSyncExternalStore } from "react";
import type { SavedSignature } from "../../platform";

export interface PlaceRequest {
  documentId: string;
  signature: SavedSignature;
}

let req: PlaceRequest | null = null;
const listeners = new Set<() => void>();

export const placeRequest = {
  get: () => req,
  set(r: PlaceRequest | null) {
    req = r;
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export function usePlaceRequest(): PlaceRequest | null {
  return useSyncExternalStore(placeRequest.subscribe, placeRequest.get);
}
