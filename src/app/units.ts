// Page measurement units (B8): the X/Y W/H readout while dragging boxes and Page
// properties show lengths in the unit picked in Preferences > Page Display.
// PDF lengths are points (1/72 inch). No DOM here.

export type Units = "in" | "mm" | "pt";

export const UNIT_LABEL: Record<Units, string> = { in: "in", mm: "mm", pt: "pt" };

const PER_POINT: Record<Units, number> = { in: 1 / 72, mm: 25.4 / 72, pt: 1 };
const DECIMALS: Record<Units, number> = { in: 2, mm: 1, pt: 0 };

export function fromPoints(pt: number, units: Units): number {
  return pt * PER_POINT[units];
}

/** 72 -> "1.00 in"; 72 (mm) -> "25.4 mm"; -0 never shows as "-0". */
export function formatLength(pt: number, units: Units): string {
  const v = fromPoints(pt, units);
  const s = v.toFixed(DECIMALS[units]);
  return `${/^-0(\.0+)?$/.test(s) ? s.slice(1) : s} ${UNIT_LABEL[units]}`;
}

export function isUnits(v: unknown): v is Units {
  return v === "in" || v === "mm" || v === "pt";
}
