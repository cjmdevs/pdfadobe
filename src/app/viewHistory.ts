// Previous view / next view (B8), like Acrobat's Alt+Left / Alt+Right and the mouse's
// back and forward buttons. A "view" is the page plus the scroll position and zoom at
// that moment. A view is remembered when the reader jumps: a page change of more than
// one page, or any Go to page / first / last / thumbnail / bookmark jump, once the new
// page has stayed for a moment. Scrolling page by page is not a jump. Kept per document
// (store id, which survives edits), in memory only. No DOM here.

export interface View {
  page: number;
  x: number;
  y: number;
  /** Zoom factor when the view was left; a different zoom restores by page only. */
  scale: number;
}

const CAP = 50;

export class ViewHistory {
  private back: View[] = [];
  private fwd: View[] = [];

  /** The reader left `from` by a jump: it can be gone back to. Clears "forward". */
  leave(from: View): void {
    const last = this.back.at(-1);
    if (last && last.page === from.page && last.x === from.x && last.y === from.y) return;
    this.back.push(from);
    if (this.back.length > CAP) this.back.shift();
    this.fwd = [];
  }

  /** Previous view, or null; `current` becomes the next view. */
  goBack(current: View): View | null {
    const v = this.back.pop();
    if (!v) return null;
    this.fwd.push(current);
    return v;
  }

  goForward(current: View): View | null {
    const v = this.fwd.pop();
    if (!v) return null;
    this.back.push(current);
    return v;
  }

  get canGoBack(): boolean {
    return this.back.length > 0;
  }
  get canGoForward(): boolean {
    return this.fwd.length > 0;
  }
}

const byStore = new Map<string, ViewHistory>();

export function viewHistory(storeId: string): ViewHistory {
  let h = byStore.get(storeId);
  if (!h) {
    h = new ViewHistory();
    byStore.set(storeId, h);
  }
  return h;
}

export function dropViewHistory(storeId: string): void {
  byStore.delete(storeId);
}

/** Set by explicit jumps (useNav.goTo) so a one-page Go to still counts as a jump. */
let explicitJump = 0;
export function markJump(): void {
  explicitJump = Date.now();
}
/** True when a jump was marked in the last `ms` milliseconds (and clears it). */
export function takeJump(ms = 1500): boolean {
  const hit = Date.now() - explicitJump < ms;
  explicitJump = 0;
  return hit;
}

/** While a back/forward restore is moving the view, page changes are not jumps. */
let restoring = 0;
export function markRestoring(): void {
  restoring = Date.now();
}
export function isRestoring(ms = 800): boolean {
  return Date.now() - restoring < ms;
}
