// Single page view shows one page, so when it fits there is nothing for the wheel to
// scroll: here the wheel turns the page instead. A page taller than the window scrolls
// first and turns at its end; going back lands at the bottom of the page before, so
// reading carries on. Ctrl+wheel (zoom) and Shift+wheel (sideways) are left alone.
import { useEffect, useLayoutEffect, useRef } from "react";
import { useNav } from "../app/useNav";
import { TURN_GAP_MS, wheelTurn } from "../app/wheelTurn";

const viewportEl = () => document.querySelector<HTMLElement>("[data-testid=viewport]");

/** Mount once per document view, in Single page mode only. */
export function SinglePageWheel({ documentId }: { documentId: string }) {
  const nav = useNav(documentId);
  const latest = useRef(nav);
  useEffect(() => {
    latest.current = nav;
  });
  const land = useRef<"top" | "bottom" | null>(null);

  useEffect(() => {
    const vp = viewportEl();
    if (!vp) return;
    let last = -TURN_GAP_MS;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      // Text being edited on the page scrolls itself.
      if (e.target instanceof Element && e.target.closest("textarea, [contenteditable=true]"))
        return;
      const turn = wheelTurn(e.deltaY, {
        top: vp.scrollTop,
        height: vp.scrollHeight,
        client: vp.clientHeight,
      });
      const n = latest.current;
      const to = n.page + turn;
      if (!turn || to < 0 || to >= n.pageCount || e.timeStamp - last < TURN_GAP_MS) return;
      last = e.timeStamp;
      land.current = turn > 0 ? "top" : "bottom";
      if (turn > 0) n.next();
      else n.prev();
    };
    vp.addEventListener("wheel", onWheel, { passive: true });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [documentId]);

  // The page just turned to: start at its top going forward, its bottom going back.
  useLayoutEffect(() => {
    const vp = viewportEl();
    if (vp && land.current) vp.scrollTop = land.current === "top" ? 0 : vp.scrollHeight;
    land.current = null;
  }, [nav.page]);
  return null;
}
