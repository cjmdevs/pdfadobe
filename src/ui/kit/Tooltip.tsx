// Kit tooltips (B8). One layer for the whole window: any element with a `title`, or an
// icon-only button with an aria-label, gets a styled tooltip after a short pause, with
// the shortcut shown as a key ("Open (Ctrl+O)" -> "Open" + [Ctrl+O]). The browser's own
// title tooltip is turned off by moving `title` to `data-tip` on first hover; an element
// whose name came only from its title gets that text as its aria-label first, so screen
// readers and tests still find it by name.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { splitTip } from "./menuText";

function tipFor(el: HTMLElement): string | null {
  const t = el.getAttribute("title");
  if (t) {
    if (!el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", t);
    el.dataset.tip = t;
    el.removeAttribute("title");
  }
  if (el.dataset.tip) return el.dataset.tip;
  // Icon-only buttons: their aria-label is the tip.
  if (el.matches("button, [role=button], [role=tab]") && !el.textContent?.trim())
    return el.getAttribute("aria-label");
  return null;
}

function target(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  return node.closest<HTMLElement>(
    "[title], [data-tip], button[aria-label], [role=button][aria-label], [role=tab][aria-label]",
  );
}

interface Shown {
  text: string;
  x: number;
  y: number;
  above: boolean;
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Shown | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    let current: HTMLElement | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const show = (el: HTMLElement, delay: number) => {
      const text = tipFor(el);
      window.clearTimeout(timer);
      if (!text) return;
      current = el;
      timer = window.setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const above = r.bottom + 40 > window.innerHeight;
        setTip({ text, x: r.left + r.width / 2, y: above ? r.top - 6 : r.bottom + 6, above });
      }, delay);
    };
    const over = (e: PointerEvent) => {
      if (document.body.classList.contains("pointer-dragging")) return;
      const el = target(e.target);
      if (el === current) return;
      hide();
      if (el) show(el, 500);
    };
    const focus = (e: FocusEvent) => {
      const el = target(e.target);
      if (el && (e.target as Element).matches(":focus-visible")) show(el, 700);
      else hide();
    };
    window.addEventListener("pointerover", over, true);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("wheel", hide, { capture: true, passive: true });
    window.addEventListener("blur", hide);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", hide, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerover", over, true);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("wheel", hide, true);
      window.removeEventListener("blur", hide);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", hide, true);
    };
  }, []);
  if (!tip) return null;
  const { label, keys } = splitTip(tip.text);
  return createPortal(
    <div
      className={`kit-tooltip${tip.above ? " above" : ""}`}
      role="tooltip"
      data-testid="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      <span>{label}</span>
      {keys && <kbd className="kit-key">{keys}</kbd>}
    </div>,
    document.body,
  );
}
