// Calculator tape lines as the rows drawn on the page (src/engine/flyer/tape.ts).
import { formatAmount, type CalcDecimals, type TapeLine } from "./calc";
import type { TapeRow } from "../engine/flyer/tape";

export function tapeRows(tape: TapeLine[], decimals: CalcDecimals): TapeRow[] {
  return tape.map((l) => ({
    amount: formatAmount(l.value, decimals),
    op: l.op === "#" ? "" : l.op,
    ...(l.note ? { note: l.note } : {}),
    ...(l.op === "T" || l.op === "=" ? { total: true } : {}),
  }));
}
