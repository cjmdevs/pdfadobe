// Zoom numbers as Acrobat shows them.
//
// EmbedPDF scale 1 draws 1 PDF point as 1 CSS pixel. A CSS pixel is 1/96 inch and a
// point is 1/72 inch, so "Actual size" (100% in Acrobat: a Letter page is 8.5 in wide on
// screen at the system's nominal DPI) is scale 96/72. All percentages shown to the user
// are relative to that.

export const ACTUAL_SIZE_SCALE = 96 / 72;

export function scaleToPercent(scale: number): number {
  return Math.round((scale / ACTUAL_SIZE_SCALE) * 1000) / 10;
}

export function percentToScale(percent: number): number {
  return (percent / 100) * ACTUAL_SIZE_SCALE;
}

/** Parses "125", "125%", " 87.5 % ". Returns null for junk or out-of-range values. */
export function parsePercent(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 5 && n <= 6400 ? n : null;
}

/** Acrobat's preset list (subset) for the zoom drop-down. */
export const ZOOM_PRESETS = [25, 50, 75, 100, 125, 150, 200, 400, 800];
