// Edit PDF: a picture of the text box or image being dragged, so the content itself is
// seen moving (the outline alone left the user guessing where the text would land).
// The picture is the page's own render of that area, taken when the press starts so it
// is ready by the time the drag is. It lives in memory only (an object URL, revoked when
// the drag ends); nothing of it is logged or saved.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRenderCapability } from "@embedpdf/plugin-render/react";
import type { Rect } from "../../engine/edit";
import { shotScale, toPageRect } from "./snapshot";

export interface Shot {
  /** What it is a picture of: "t<box id>" or "i<image id>". */
  key: string;
  url: string;
  /** The area pictured (PDF points, bottom-left origin). */
  rect: Rect;
}

export interface DragPreviewControl {
  /** Takes the picture; a later start or stop drops an earlier one. */
  start(key: string, rect: Rect | null, pageHeight: number, scale: number): void;
  stop(): void;
}

export function useDragPreview(
  documentId: string,
  pageIndex: number,
): [Shot | null, DragPreviewControl] {
  const { provides: render } = useRenderCapability();
  const [shot, setShot] = useState<Shot | null>(null);
  const live = useRef({ render, documentId, pageIndex, job: 0, url: null as string | null });
  useEffect(() => {
    Object.assign(live.current, { render, documentId, pageIndex });
  });

  const control = useMemo<DragPreviewControl>(() => {
    const drop = () => {
      live.current.job++;
      if (live.current.url) URL.revokeObjectURL(live.current.url);
      live.current.url = null;
    };
    return {
      start(key, rect, pageHeight, scale) {
        drop();
        setShot(null);
        const c = live.current;
        if (!rect || !c.render) return;
        const job = c.job;
        try {
          c.render
            .forDocument(c.documentId)
            .renderPageRect({
              pageIndex: c.pageIndex,
              rect: toPageRect(rect, pageHeight),
              // No white card behind it: the text floats over what it is dragged across.
              options: {
                ...shotScale(scale, window.devicePixelRatio),
                transparentBackground: true,
              },
            })
            .toPromise()
            .then((blob) => {
              if (live.current.job !== job) return;
              const url = URL.createObjectURL(blob);
              live.current.url = url;
              setShot({ key, url, rect });
            })
            // No picture: the outline still moves, as before.
            .catch(() => undefined);
        } catch {
          // The document was just replaced by an edit.
        }
      },
      stop() {
        drop();
        setShot(null);
      },
    };
  }, []);

  useEffect(
    () => () => {
      live.current.job++;
      if (live.current.url) URL.revokeObjectURL(live.current.url);
      live.current.url = null;
    },
    [],
  );
  return [shot, control];
}
