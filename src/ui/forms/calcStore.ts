// The calculation setup of each open tab (Phase 6): read once per document, used by the
// live recalculation (FormCalc), number formatting on commit (TextFill), the Fill Forms
// panel's "calculated in Acrobat only" note, and the raw-number pass on push.
import { useSyncExternalStore } from "react";
import type { CalcSetup } from "../../engine/forms";

let setups: Record<string, CalcSetup> = {};
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const calcs = {
  get: (documentId: string): CalcSetup | null => setups[documentId] ?? null,
  set(documentId: string, setup: CalcSetup | null) {
    const next = Object.fromEntries(Object.entries(setups).filter(([k]) => k !== documentId));
    if (setup) next[documentId] = setup;
    setups = next;
    listeners.forEach((l) => l());
  },
};

export function useCalcSetup(documentId: string): CalcSetup | null {
  return useSyncExternalStore(subscribe, () => calcs.get(documentId));
}
