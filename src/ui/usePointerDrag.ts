// In-app drag and drop with pointer events. HTML5 drag-and-drop does not work in the
// Windows app: Tauri replaces WebView2's drag-drop handler so files dropped from
// Explorer arrive with their paths (tauri.conf.json `dragDropEnabled`), and that blocks
// HTML5 drags inside the page. tests/e2e/fixtures.ts blocks them the same way.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface PointerDrag<S> {
  /** What is being dragged, once the pointer has moved past the threshold. */
  source: S | null;
  /** Call from onPointerDown of a draggable element. */
  start(e: ReactPointerEvent, source: S): void;
}

/**
 * `onMove` gets the element under the pointer (use closest() to find a drop target);
 * `onDrop` runs on release. Escape cancels. The click that ends a drag is swallowed.
 */
export function usePointerDrag<S>(handlers: {
  onMove(source: S, under: Element | null, e: PointerEvent): void;
  onDrop(source: S, under: Element | null, e: PointerEvent): void;
  onCancel(): void;
  disabled?: boolean;
}): PointerDrag<S> {
  const [source, setSource] = useState<S | null>(null);
  const h = useRef(handlers);
  useEffect(() => {
    h.current = handlers;
  });
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const start = (e: ReactPointerEvent, s: S) => {
    if (e.button !== 0 || h.current.disabled) return;
    if ((e.target as HTMLElement).closest("input, textarea, select, .twisty")) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let active = false;
    const under = (ev: PointerEvent) => document.elementFromPoint(ev.clientX, ev.clientY);
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        active = true;
        setSource(s);
        document.body.classList.add("pointer-dragging");
      }
      ev.preventDefault();
      h.current.onMove(s, under(ev), ev);
    };
    const up = (ev: PointerEvent) => {
      const was = active;
      end();
      if (!was) return;
      // Swallow the click that follows the release (same task), not later ones.
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      h.current.onDrop(s, under(ev), ev);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      end();
      h.current.onCancel();
    };
    const end = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("keydown", key, true);
      document.body.classList.remove("pointer-dragging");
      setSource(null);
      cleanup.current = null;
    };
    cleanup.current?.();
    cleanup.current = end;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("keydown", key, true);
  };
  return { source, start };
}

function swallow(e: Event) {
  e.stopPropagation();
  e.preventDefault();
}
