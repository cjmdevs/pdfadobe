// Scan & OCR state (Phase 7): Recognize Text settings, and the run in progress (one at a
// time, across documents and the folder batch). Memory only: never saved or logged.
import { useSyncExternalStore } from "react";

export type PageScope = "page" | "range" | "all";

export interface RunState {
  /** What is running: one document, or the folder batch. */
  kind: "document" | "batch";
  documentId: string | null;
  /** 0-based page being read, or null between pages. */
  page: number | null;
  done: number;
  total: number;
  cancel(): void;
}

interface State {
  scope: PageScope;
  range: string;
  skipText: boolean;
  straighten: boolean;
  run: RunState | null;
  /** Outcome of the last run on each document (by store id), shown in the panel. */
  last: Record<string, string>;
}

let state: State = {
  scope: "all",
  range: "",
  skipText: true,
  straighten: true,
  run: null,
  last: {},
};
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const scan = {
  get: () => state,
  set,
  start: (run: RunState) => set({ run }),
  progress: (p: { page: number | null; done: number; total: number }) => {
    if (state.run) set({ run: { ...state.run, ...p } });
  },
  finish: (documentId: string | null, outcome: string | null) =>
    set({
      run: null,
      last: documentId && outcome ? { ...state.last, [documentId]: outcome } : state.last,
    }),
};

export function useScan(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
