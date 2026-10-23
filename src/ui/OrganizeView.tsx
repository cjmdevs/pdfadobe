// Organize Pages: a grid of page thumbnails. Select with click / Ctrl+click / Shift+click /
// Ctrl+A, drag to reorder. The tool's toolbar (src/tools/registry.ts, shown by the shell)
// acts on the selection, which lives in the tab's state (DocMeta.pageSelection). Every
// change is one undoable step (Ctrl+Z / Ctrl+Y).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useThumbnailCapability } from "@embedpdf/plugin-thumbnail/react";
import { usePageActions } from "../app/pageActions";
import { useWorkbench } from "../app/workbench";
import { usePointerDrag } from "./usePointerDrag";

export function OrganizeView({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const actions = usePageActions(documentId);
  const doc = useDocumentState(documentId)?.document ?? null;
  const count = doc?.pageCount ?? 0;
  // After a reload (new revision), start at the page the operation affected.
  const [restored] = useState(() => wb.restorePage(documentId));
  // The pages an edit worked on stay selected, so the next button acts on them too.
  const stored = wb.meta[documentId]?.pageSelection;
  const [initial] = useState(() => (stored?.length ? stored : restored === null ? [] : [restored]));
  const selected = useMemo(() => new Set(stored ?? initial), [stored, initial]);
  const setSelected = (next: Set<number>) =>
    wb.setPageSelection(
      documentId,
      [...next].sort((a, b) => a - b),
    );
  const [anchor, setAnchor] = useState(restored ?? 0);
  const [focus, setFocus] = useState(restored ?? 0);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stored) wb.setPageSelection(documentId, initial);
    if (restored === null) return;
    wb.clearRestorePage(documentId);
    requestAnimationFrame(() =>
      grid.current
        ?.querySelector<HTMLElement>(`[data-page="${restored}"]`)
        ?.scrollIntoView({ block: "nearest" }),
    );
    // Once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  const sel = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  const busy = wb.busy !== null;
  const has = sel.length > 0;

  const select = (i: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    setFocus(i);
    if (e.shiftKey) {
      const [a, b] = anchor <= i ? [anchor, i] : [i, anchor];
      const range = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      setSelected(new Set(e.ctrlKey || e.metaKey ? [...selected, ...range] : range));
      return;
    }
    setAnchor(i);
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      setSelected(next);
    } else setSelected(new Set([i]));
  };

  const onKey = (e: KeyboardEvent) => {
    const cols = Math.max(
      1,
      Math.round(
        (grid.current?.clientWidth ?? 600) /
          ((grid.current?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 180),
      ),
    );
    const move = (to: number) => {
      const i = Math.max(0, Math.min(count - 1, to));
      select(i, { ctrlKey: false, metaKey: false, shiftKey: e.shiftKey });
      grid.current?.querySelector<HTMLElement>(`[data-page="${i}"]`)?.focus();
    };
    if (e.key === "ArrowRight") move(focus + 1);
    else if (e.key === "ArrowLeft") move(focus - 1);
    else if (e.key === "ArrowDown") move(focus + cols);
    else if (e.key === "ArrowUp") move(focus - cols);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(count - 1);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      setSelected(new Set(Array.from({ length: count }, (_, i) => i)));
    } else if (e.key === "Delete" && has && !busy) void actions.remove(sel);
    else if (e.key === "Escape" && has) setSelected(new Set());
    else if (e.key === "Enter") wb.setActiveTool(documentId, null, focus);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // Drag (pointer events; see usePointerDrag): the selection if the dragged page is
  // selected, else just that page. The drop position is before/after the page under the
  // pointer, by which half of it the pointer is over.
  const dropIndex = (under: Element | null, x: number): number | null => {
    const cell = under?.closest<HTMLElement>("[data-page]");
    if (!cell || !grid.current?.contains(cell)) return null;
    const i = Number(cell.dataset.page);
    const r = cell.getBoundingClientRect();
    return x < r.left + r.width / 2 ? i : i + 1;
  };
  const drag = usePointerDrag<number[]>({
    disabled: busy,
    onMove: (_pages, under, e) => setDropAt(dropIndex(under, e.clientX)),
    onCancel: () => setDropAt(null),
    onDrop: (pages, under, e) => {
      setDropAt(null);
      const at = dropIndex(under, e.clientX);
      if (at === null) return;
      // No-op if dropped inside or right next to a contiguous selection.
      const contiguous = pages.every((p, k) => k === 0 || p === (pages[k - 1] ?? -2) + 1);
      if (contiguous && at >= (pages[0] ?? 0) && at <= (pages[pages.length - 1] ?? 0) + 1) return;
      void actions.move(pages, at >= count ? null : at);
    },
  });
  const startDrag = (e: React.PointerEvent, i: number) => {
    drag.start(e, selected.has(i) ? sel : [i]);
  };

  if (!doc) return null;
  return (
    <div className="organize" data-testid="organize">
      <div className="organize-status">
        <span className="muted small" data-testid="selection-count">
          {has ? `${sel.length} of ${count} selected` : `${count} pages`}
        </span>
        <span className="muted small">
          Click, Ctrl+click or Shift+click to select; drag to move; Delete removes.
        </span>
      </div>
      <div
        ref={grid}
        className="page-grid"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Pages"
        onKeyDown={onKey}
      >
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            data-page={i}
            data-testid="grid-page"
            role="option"
            aria-selected={selected.has(i)}
            aria-label={`Page ${i + 1}`}
            tabIndex={i === focus ? 0 : -1}
            className={`grid-page${selected.has(i) ? " selected" : ""}${drag.source?.includes(i) ? " dragging" : ""}${dropAt === i ? " drop-before" : ""}${dropAt === i + 1 && i === count - 1 ? " drop-after" : ""}`}
            onPointerDown={(e) => startDrag(e, i)}
            onClick={(e) => select(i, e)}
            onDoubleClick={() => wb.setActiveTool(documentId, null, i)}
          >
            <Thumb documentId={documentId} index={i} />
            <span className="grid-label">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Lazily rendered thumbnail (only once it scrolls near the viewport). */
function Thumb({ documentId, index }: { documentId: string; index: number }) {
  const { provides } = useThumbnailCapability();
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setVisible(true), {
      rootMargin: "400px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !provides) return;
    let live = true;
    let made: string | null = null;
    provides
      .forDocument(documentId)
      .renderThumb(index, window.devicePixelRatio || 1)
      .wait(
        (blob) => {
          if (!live) return;
          made = URL.createObjectURL(blob);
          setUrl(made);
        },
        () => undefined,
      );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [visible, provides, documentId, index]);
  return (
    <div ref={ref} className="grid-thumb">
      {url ? <img src={url} alt="" draggable={false} /> : <span className="grid-thumb-empty" />}
    </div>
  );
}
