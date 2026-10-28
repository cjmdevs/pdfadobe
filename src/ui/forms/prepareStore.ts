// Prepare Form (Phase 6): the field kind waiting to be placed with a click, per tab, and
// which radio group new radio buttons join. Shared by the toolbar, the panel and the
// page layer through this tiny store.
import { useSyncExternalStore } from "react";
import type { NewFieldKind } from "../../engine/forms";

/** Interaction mode while a field waits for its click (FieldPlaceLayer). */
export const FIELD_MODE = "formFieldPlace";

/** Tool id of Prepare Form; form widgets are unlocked (design mode) while it is open. */
export const PREPARE_TOOL = "prepareForm";

interface State {
  pending: Record<string, NewFieldKind | null>;
  /** By store id (stable across edits). "" = the next radio button starts a new group. */
  radioGroup: Record<string, string>;
}

let state: State = { pending: {}, radioGroup: {} };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const prepare = {
  pending: (doc: string) => state.pending[doc] ?? null,
  arm(doc: string, kind: NewFieldKind | null) {
    state = { ...state, pending: { ...state.pending, [doc]: kind } };
    emit();
  },
  radioGroup: (doc: string) => state.radioGroup[doc] ?? "",
  setRadioGroup(doc: string, group: string) {
    state = { ...state, radioGroup: { ...state.radioGroup, [doc]: group } };
    emit();
  },
};

export function usePrepare(doc: string): { pending: NewFieldKind | null; radioGroup: string } {
  const pending = useSyncExternalStore(subscribe, () => prepare.pending(doc));
  const radioGroup = useSyncExternalStore(subscribe, () => prepare.radioGroup(doc));
  return { pending, radioGroup };
}
