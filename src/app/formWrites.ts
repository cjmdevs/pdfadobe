// Form-field writes still running in the tab's PDFium document (Phase 6). Save and page
// operations wait for them, so a value typed just before Ctrl+S is in the saved bytes.

interface Waitable {
  toPromise(): Promise<unknown>;
}

const running = new Set<Promise<unknown>>();

export function trackFormWrite(task: Waitable): void {
  const p = task.toPromise().catch(() => undefined);
  running.add(p);
  void p.finally(() => running.delete(p));
}

/** Ends any field edit in progress (it commits on blur), then waits for every write. */
export async function flushFormWrites(): Promise<void> {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest("[data-form-field]")) active.blur();
  while (running.size) await Promise.all([...running]);
}
