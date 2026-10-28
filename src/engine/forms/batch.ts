// Fill many copies from a CSV (Phase 6): one filled PDF per data row. The app writes each
// copy as it is made (never all of them in memory), into a folder the user picks, never
// over an existing file. Node-safe.

import { findMatches } from "../redact/patterns";
import type { PagesCtx } from "../pages";
import { fillForm, type FieldValues, type FillReport } from "./fill";
import { finishFormSave, type XfaPolicy } from "./xfa";

export async function fillCopy(
  ctx: PagesCtx,
  template: Uint8Array,
  values: FieldValues,
  xfa: XfaPolicy,
): Promise<FillReport & { bytes: Uint8Array }> {
  const r = await fillForm(ctx.engine, template, values);
  return { ...r, bytes: await finishFormSave(ctx, r.bytes, xfa) };
}

/**
 * True when a column holds SSNs or EINs. Such values never go into a file name (firm
 * rule: no SSNs, EINs or account numbers in file names).
 */
export function looksSensitive(values: string[]): boolean {
  return values.some((v) => findMatches(v, { patterns: ["ssn", "ein"] }).length > 0);
}

/** Characters Windows does not allow in a file name, and trailing dots and spaces. */
function cleanName(s: string): string {
  return [...s]
    .map((c) => (c.charCodeAt(0) < 0x20 ? " " : c))
    .join("")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 120);
}

/**
 * "<form> - <value>.pdf" from the chosen column, or "<form> - 001.pdf" by row number
 * (also when the row's cell is empty). Repeats get " (2)" from the writer.
 */
export function copyFileName(
  formStem: string,
  row: number,
  total: number,
  nameValue?: string,
): string {
  const base = cleanName(formStem) || "Form";
  const label = nameValue ? cleanName(nameValue) : "";
  const num = String(row + 1).padStart(Math.max(3, String(total).length), "0");
  return `${base} - ${label || num}.pdf`;
}
