// Tickmark toolbar sections (owner request 2026-10-27): the library split the way
// PDFlyer's tickmark buttons are (Letters, Numbers, Checks, Confirmations, Footing, Other,
// Mine). Letter and number tickmarks offer every value as its own pick. Node-safe.

import {
  LETTER_VALUES,
  NUMBER_VALUES,
  TICK_SECTIONS,
  type TickSection,
  type TickmarkDef,
} from "../engine/flyer/tickmarks";
import { tickRef, type LibraryEntry } from "./library";

/** One thing a button can place: a tickmark, with its letter or number if it has one. */
export interface TickPick {
  /** "footed", "letter:A". */
  ref: string;
  def: TickmarkDef;
  label?: string;
}

export interface TickSectionPicks {
  id: TickSection;
  label: string;
  glyph: string;
  picks: TickPick[];
}

/** "Footed", "Letter A". */
export const pickLabel = (p: TickPick) => (p.label ? `${p.def.name} ${p.label}` : p.def.name);

/** Every section with its picks, in toolbar order. */
export function sectionPicks(library: LibraryEntry[]): TickSectionPicks[] {
  return TICK_SECTIONS.map((sec) => ({
    ...sec,
    picks: library
      .filter((e) => (e.def.section ?? "mine") === sec.id)
      .flatMap((e): TickPick[] => {
        const values =
          e.def.variable === "letters"
            ? LETTER_VALUES
            : e.def.variable === "numbers"
              ? NUMBER_VALUES
              : null;
        return values
          ? values.map((v) => ({ ref: tickRef(e.def.id, v), def: e.def, label: v }))
          : [{ ref: e.def.id, def: e.def }];
      }),
  }));
}
