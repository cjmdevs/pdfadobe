// Edit PDF (B3 stage 2): a list button in the Format panel (bulleted or numbered). One
// click opens its styles; picking one makes the list in that style, "None" takes it
// off. The button shows the style in use.
import { useEffect, useRef, useState } from "react";
import { markerText, type ListStyle } from "../../engine/edit/lists";

export function ListMenu({
  label,
  glyph,
  styles,
  current,
  disabled,
  onPick,
}: {
  label: string;
  glyph: string;
  /** Each style this button offers. */
  styles: ListStyle[];
  /** The list in use when it is this button's kind, else null. */
  current: ListStyle | null;
  disabled: boolean;
  onPick(list: ListStyle | null): void;
}) {
  /** Where the menu opens (screen pixels, under the button), or null when closed. */
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(null);
    };
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const sample = (l: ListStyle) =>
    l.kind === "bullet" ? l.glyph : [1, 2, 3].map((n) => markerText(l, n)).join(" ");
  const same = (a: ListStyle, b: ListStyle | null) =>
    !!b &&
    a.kind === b.kind &&
    (a.kind === "bullet"
      ? b.kind === "bullet" && a.glyph === b.glyph
      : b.kind === "number" && a.format === b.format);
  const pick = (l: ListStyle | null) => {
    setOpen(null);
    onPick(l);
  };

  return (
    <span className="list-menu" ref={root}>
      <button
        type="button"
        className={`format-toggle list-button${current ? " pressed" : ""}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-pressed={current !== null}
        title={label}
        disabled={disabled}
        // Keep the editor's selection.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { x: r.left, y: r.bottom + 2 });
        }}
      >
        {current ? sample(current).split(" ")[0] : glyph} ▾
      </button>
      {open && (
        // Fixed on screen: the side panel scrolls and would cut it off.
        <span
          className="list-menu-items"
          role="menu"
          aria-label={`${label} styles`}
          style={{ left: open.x, top: open.y }}
        >
          {styles.map((l) => (
            <button
              key={sample(l)}
              type="button"
              role="menuitemradio"
              aria-checked={same(l, current)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(l)}
            >
              {sample(l)}
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={current === null}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(null)}
          >
            None
          </button>
        </span>
      )}
    </span>
  );
}
