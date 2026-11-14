// Kit menus (B8): one menu list for the menu bar, right-click menus and the top bar's
// overflow menu. Items show their shortcut on the right; submenus open to the side with
// the mouse or Right arrow and close with Left arrow. Up/Down/Home/End move, Enter or
// Space presses (they are buttons), Escape closes. Menus never hold document state:
// callers build the entries each time they open one.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { displayKey } from "../../app/shortcuts";
import { tidy, type MenuEntry } from "./menuText";

export type { MenuEntry, MenuItemEntry, SubmenuEntry, DividerEntry } from "./menuText";
export { tidy } from "./menuText";

const ITEM = "[role^=menuitem]:not(:disabled)";

function ownItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(ITEM)].filter(
    (el) => el.closest("[role=menu]") === menu,
  );
}

export function MenuList({
  items,
  label,
  onClose,
  onLeft,
  onRight,
  focusFirst = true,
  className,
}: {
  items: MenuEntry[];
  label: string;
  /** Called after an item runs, or on Escape. */
  onClose: (reason: "run" | "escape") => void;
  /** Left arrow on a top-level menu (menu bar: previous menu). */
  onLeft?: () => void;
  /** Right arrow on an item without a submenu (menu bar: next menu). */
  onRight?: () => void;
  focusFirst?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (focusFirst && ref.current) ownItems(ref.current)[0]?.focus();
  }, [focusFirst]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const menu = ref.current;
    if (!menu || e.target instanceof HTMLInputElement) return;
    // Keys inside an open submenu belong to it.
    if ((e.target as HTMLElement).closest("[role=menu]") !== menu) return;
    const list = ownItems(menu);
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => list.at((n + list.length) % list.length)?.focus();
    const sub = (document.activeElement as HTMLElement | null)?.dataset.submenu;
    switch (e.key) {
      case "ArrowDown":
        go(i + 1);
        break;
      case "ArrowUp":
        go(i < 0 ? -1 : i - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(-1);
        break;
      case "ArrowRight":
        if (sub) setOpen(sub);
        else if (onRight) onRight();
        else return;
        break;
      case "ArrowLeft":
        if (onLeft) onLeft();
        else return;
        break;
      case "Escape":
        onClose("escape");
        break;
      case "Tab":
        onClose("escape");
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={ref}
      className={`menu kit-menu${className ? ` ${className}` : ""}`}
      role="menu"
      aria-label={label}
      onKeyDown={onKey}
    >
      {tidy(items).map((it, k) => {
        if (it.kind === "divider") return <hr key={`d${k}`} />;
        if (it.kind === "submenu")
          return (
            <div
              key={it.id}
              className="kit-sub"
              onPointerEnter={() => {
                window.clearTimeout(hoverTimer.current);
                hoverTimer.current = window.setTimeout(() => setOpen(it.id), 150);
              }}
              onPointerLeave={() => {
                window.clearTimeout(hoverTimer.current);
                hoverTimer.current = window.setTimeout(
                  () => setOpen((cur) => (cur === it.id ? null : cur)),
                  250,
                );
              }}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-label={it.label}
                aria-expanded={open === it.id}
                data-submenu={it.id}
                disabled={it.disabled}
                onClick={() => setOpen(open === it.id ? null : it.id)}
              >
                <span className="kit-check" aria-hidden="true" />
                <span className="kit-label">{it.label}</span>
                <span className="kit-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
              {open === it.id && (
                <Flyout>
                  <MenuList
                    items={it.items}
                    label={it.label}
                    onClose={(why) => {
                      setOpen(null);
                      if (why === "run") onClose("run");
                      else
                        ref.current
                          ?.querySelector<HTMLElement>(`[data-submenu="${it.id}"]`)
                          ?.focus();
                    }}
                    onLeft={() => {
                      setOpen(null);
                      ref.current?.querySelector<HTMLElement>(`[data-submenu="${it.id}"]`)?.focus();
                    }}
                    className="kit-flyout"
                  />
                </Flyout>
              )}
            </div>
          );
        return (
          <button
            key={it.id}
            type="button"
            role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={it.checked}
            aria-label={it.label}
            aria-keyshortcuts={it.shortcut}
            className={it.danger ? "danger" : undefined}
            disabled={it.disabled}
            onPointerEnter={() => setOpen(null)}
            onClick={() => {
              onClose("run");
              it.run();
            }}
          >
            <span className="kit-check" aria-hidden="true">
              {it.checked ? "✓" : ""}
            </span>
            <span className="kit-label">{it.label}</span>
            {it.shortcut && <kbd className="kit-key">{displayKey(it.shortcut)}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

/** Keeps a submenu on screen: opens to the left when there is no room on the right. */
function Flyout({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 4) el.classList.add("flip");
    if (r.bottom > window.innerHeight - 4)
      el.style.top = `${Math.max(-r.top + 4, window.innerHeight - 4 - r.bottom)}px`;
  }, []);
  return (
    <div ref={ref} className="kit-flyout-host">
      {children}
    </div>
  );
}

/**
 * A right-click menu at the pointer, kept inside the window. Closes on a click outside,
 * Escape, or when the window loses focus (not on scrolling: lists scroll themselves); focus goes back to where it was.
 */
export function ContextMenu({
  x,
  y,
  items,
  label,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuEntry[];
  label: string;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const back = useRef<Element | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useLayoutEffect(() => {
    back.current = document.activeElement;
    const r = host.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) close.current();
    };
    const away = () => close.current();
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", away);
    window.addEventListener("resize", away);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", away);
      window.removeEventListener("resize", away);
    };
  }, []);
  return createPortal(
    <div
      ref={host}
      className="context-menu-host"
      style={{ position: "fixed", left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList
        items={items}
        label={label}
        onClose={(why) => {
          close.current();
          if (why === "escape" && back.current instanceof HTMLElement) back.current.focus();
        }}
      />
    </div>,
    document.body,
  );
}

/** State helper for a right-click menu: `menu.open(e, payload)` in onContextMenu. */
export function useContextMenu<T>() {
  const [state, setState] = useState<{ x: number; y: number; data: T } | null>(null);
  return {
    state,
    open: (e: { clientX: number; clientY: number; preventDefault(): void }, data: T) => {
      e.preventDefault();
      setState({ x: e.clientX, y: e.clientY, data });
    },
    /** For Shift+F10 / the Menu key: opens at an element's corner. */
    openAt: (el: Element, data: T) => {
      const r = el.getBoundingClientRect();
      setState({ x: r.left + 8, y: r.top + Math.min(r.height, 24), data });
    },
    close: () => setState(null),
  };
}
