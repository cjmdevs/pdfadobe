// Single page view: the wheel turns the page once the page on screen has nothing left
// to scroll that way (a page that fits turns on every notch), like Acrobat.

/** At most one page turn per this long, so one spin of the wheel is not a dozen pages. */
export const TURN_GAP_MS = 150;

export interface ScrollEdge {
  /** scrollTop, scrollHeight and clientHeight of the scrolling element. */
  top: number;
  height: number;
  client: number;
}

/** 1: next page, -1: previous page, 0: let the wheel scroll. */
export function wheelTurn(deltaY: number, at: ScrollEdge): -1 | 0 | 1 {
  if (deltaY > 0 && at.top + at.client >= at.height - 1) return 1;
  if (deltaY < 0 && at.top <= 1) return -1;
  return 0;
}
