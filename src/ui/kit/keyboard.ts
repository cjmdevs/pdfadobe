// Keyboard movement for toolbars and menus (B7 accessibility). Every control stays a Tab
// stop; arrow keys also move between them, like Office ribbons. Arrows, Home and End are
// page shortcuts too, so a toolbar only takes them while the user is moving by keyboard
// (reached the toolbar with Tab): after a mouse click on "Next page", End still goes to the
// last page. (:focus-visible cannot tell: any key press turns it on.)
import { useEffect, type KeyboardEvent, type RefObject } from "react";

let byKeyboard = false;
if (typeof document !== "undefined") {
  document.addEventListener("keydown", (e) => e.key === "Tab" && (byKeyboard = true), true);
  document.addEventListener("pointerdown", () => (byKeyboard = false), true);
}

const FOCUSABLE =
  "button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']";

function move(items: HTMLElement[], from: Element | null, key: string): HTMLElement | null {
  if (!items.length) return null;
  const i = items.findIndex((el) => el === from || el.contains(from));
  if (key === "Home") return items.at(0) ?? null;
  if (key === "End") return items.at(-1) ?? null;
  const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
  return items.at((i + step + items.length) % items.length) ?? null;
}

/** Left/Right (and Home/End) between a toolbar's controls. Text fields keep their arrows. */
export function onToolbarKeys(e: KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return;
  if (!byKeyboard) return;
  if (t.closest("[role=menu]")) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest("[role=menu]") && el.offsetParent !== null,
  );
  const next = move(items, t, e.key);
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

/** Up/Down (and Home/End) between a menu's items; focuses the first item on open. */
export function onMenuKeys(e: KeyboardEvent<HTMLElement>) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  const next = move(items, document.activeElement, e.key);
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

export function useFocusFirst(ref: RefObject<HTMLElement | null>, when: boolean) {
  useEffect(() => {
    if (when) ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [ref, when]);
}
