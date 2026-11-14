// Drag feedback (B8): a see-through copy of what is being dragged that follows the
// pointer, the X/Y W/H readout next to a box on the page, and snap guide lines.
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatLength, type Units } from "../../app/units";
import type { Box, Guide } from "./snap";

/** Follows the pointer (fixed position), never catches the pointer itself. */
export function DragGhost({
  pos,
  children,
  count,
}: {
  pos: { x: number; y: number } | null;
  children: ReactNode;
  /** Shows a badge when more than one item is dragged. */
  count?: number;
}) {
  if (!pos) return null;
  return createPortal(
    <div
      className="drag-ghost"
      data-testid="drag-ghost"
      aria-hidden="true"
      style={{ left: pos.x + 12, top: pos.y + 12 }}
    >
      {children}
      {count !== undefined && count > 1 && <span className="drag-ghost-count">{count}</span>}
    </div>,
    document.body,
  );
}

/**
 * Position and size of a box on the page, drawn just above it (below when there is no
 * room). `box` is in page points; `scale` turns points into the layer's pixels.
 */
export function BoxReadout({
  box,
  scale,
  units,
  size = true,
}: {
  box: Box;
  scale: number;
  units: Units;
  /** Moving keeps the size, so it can be left out. */
  size?: boolean;
}) {
  const top = box.y * scale;
  const below = top < 26;
  return (
    <div
      className="box-readout"
      data-testid="box-readout"
      aria-live="off"
      style={{
        left: box.x * scale,
        top: below ? (box.y + box.h) * scale + 4 : top - 4,
        transform: below ? undefined : "translateY(-100%)",
      }}
    >
      <span>X {formatLength(box.x, units)}</span>
      <span>Y {formatLength(box.y, units)}</span>
      {size && (
        <>
          <span>W {formatLength(box.w, units)}</span>
          <span>H {formatLength(box.h, units)}</span>
        </>
      )}
    </div>
  );
}

/** Snap guide lines inside a page layer (positioned like the layer's other children). */
export function SnapGuides({ guides, scale }: { guides: Guide[]; scale: number }) {
  return (
    <>
      {guides.map((g, i) => (
        <div
          key={i}
          className={`snap-guide ${g.axis}`}
          data-testid="snap-guide"
          aria-hidden="true"
          style={
            g.axis === "x"
              ? { left: g.at * scale, top: g.from * scale, height: (g.to - g.from) * scale }
              : { top: g.at * scale, left: g.from * scale, width: (g.to - g.from) * scale }
          }
        />
      ))}
    </>
  );
}

/** Scrolls a list while a drag is near its top or bottom edge. */
export function autoScroll(el: Element | null, y: number) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (y < r.top + 32) el.scrollTop -= 14;
  else if (y > r.bottom - 32) el.scrollTop += 14;
}
