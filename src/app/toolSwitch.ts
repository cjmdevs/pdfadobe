// Leaving a tool stops what it was doing (owner, B8): a markup tool such as Rectangle, a
// stamp or tickmark waiting to be placed, a box being drawn. Only what was already
// running before the switch stops; something started by the same click that opened the
// new tool (Redact > Draw box from the top bar) stays on. Pure logic, no DOM.

export interface Running {
  /** The tab's open tool (its toolbar), or null. */
  tool: string | null;
  /** The markup tool that is on (Rectangle, Highlight...), or null. */
  markup: string | null;
  /** The page interaction mode (stamp, tickmark, redact box, field...). */
  mode: string;
  /** What is waiting to be placed, by identity. */
  stamp: unknown;
  flyer: unknown;
}

/** What to stop now that the open tool changed from `was.tool` to `now.tool`. */
export function leftRunning(was: Running, now: Running): { markup: boolean; mode: boolean } {
  if (was.tool === now.tool) return { markup: false, mode: false };
  return {
    markup: now.markup !== null && now.markup === was.markup,
    mode: now.mode === was.mode && now.stamp === was.stamp && now.flyer === was.flyer,
  };
}
