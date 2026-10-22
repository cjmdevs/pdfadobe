// Organize Pages: a grid of page thumbnails. Select with click / Ctrl+click / Shift+click /
// Ctrl+A, drag to reorder, and run page operations on the selection. Every change is one
// undoable step (Ctrl+Z / Ctrl+Y).
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useThumbnailCapability } from "@embedpdf/plugin-thumbnail/react";
import { usePageActions } from "../app/pageActions";
import { useWorkbench, type PageOpDialog } from "../app/workbench";
import { Icon, type IconName } from "./Icon";

export function OrganizeView({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const actions = usePageActions(documentId);
  const doc = useDocumentState(documentId)?.document ?? null;
  const count = doc?.pageCount ?? 0;
  // After a reload (new revision), start at the page the operation affected.
  const [restored] = useState(() => wb.restorePage(documentId));
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(restored === null ? [] : [restored]),
  );
  const [anchor, setAnchor] = useState(restored ?? 0);
  const [focus, setFocus] = useState(restored ?? 0);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragging = useRef<number[] | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
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

  const openDialog = (op: PageOpDialog) =>
    wb.setDialog({ kind: "pageOp", op, documentId, pages: has ? sel : [focus] });

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
    else if (e.key === "Enter") wb.setOrganize(documentId, false, focus);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // Drag: the selection if the dragged page is selected, else just that page.
  const onDragStart = (e: DragEvent, i: number) => {
    dragging.current = selected.has(i) ? sel : [i];
    if (!selected.has(i)) setSelected(new Set([i]));
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-pdfwb-pages", dragging.current.join(","));
  };
  const onDragOver = (e: DragEvent, i: number) => {
    if (!dragging.current) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const pages = dragging.current;
    const at = dropAt;
    dragging.current = null;
    setDropAt(null);
    if (!pages || at === null) return;
    // No-op if dropped inside or right next to a contiguous selection.
    const contiguous = pages.every((p, k) => k === 0 || p === (pages[k - 1] ?? -2) + 1);
    if (contiguous && at >= (pages[0] ?? 0) && at <= (pages[pages.length - 1] ?? 0) + 1) return;
    void actions.move(pages, at >= count ? null : at);
  };

  if (!doc) return null;
  return (
    <div className="organize" data-testid="organize">
      <div className="organize-bar" role="toolbar" aria-label="Organize pages">
        <span className="muted small" data-testid="selection-count">
          {has ? `${sel.length} of ${count} selected` : `${count} pages`}
        </span>
        <span className="sep" />
        <Act
          icon="rotateCcw"
          label="Rotate left"
          disabled={!has || busy}
          onClick={() => void actions.rotate(sel, 3)}
        />
        <Act
          icon="rotateCw"
          label="Rotate right"
          disabled={!has || busy}
          onClick={() => void actions.rotate(sel, 1)}
        />
        <Act
          icon="trash"
          label="Delete (Del)"
          disabled={!has || busy}
          onClick={() => void actions.remove(sel)}
        />
        <Act
          icon="extract"
          label="Extract to new file"
          disabled={!has || busy}
          onClick={() => void actions.extract(sel)}
        />
        <Act
          icon="duplicate"
          label="Duplicate"
          disabled={!has || busy}
          onClick={() => void actions.duplicate(sel)}
        />
        <span className="sep" />
        <Act
          icon="blank"
          label="Insert blank page…"
          disabled={busy}
          onClick={() => openDialog("blank")}
        />
        <Act
          icon="insert"
          label="Insert from file…"
          disabled={busy}
          onClick={() => openDialog("insert")}
        />
        <Act
          icon="replace"
          label="Replace pages…"
          disabled={!has || busy}
          onClick={() => openDialog("replace")}
        />
        <Act icon="crop" label="Crop pages…" disabled={busy} onClick={() => openDialog("crop")} />
        <Act
          icon="pageSize"
          label="Page size…"
          disabled={busy}
          onClick={() => openDialog("pageSize")}
        />
        <Act
          icon="split"
          label="Split document…"
          disabled={busy}
          onClick={() => openDialog("split")}
        />
        <span className="grow" />
        <button type="button" onClick={() => wb.setOrganize(documentId, false)}>
          Close Organize
        </button>
      </div>
      <div
        ref={grid}
        className="page-grid"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Pages"
        onKeyDown={onKey}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropAt(null);
        }}
        onDrop={onDrop}
        onDragOver={(e) => dragging.current && e.preventDefault()}
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
            className={`grid-page${selected.has(i) ? " selected" : ""}${dropAt === i ? " drop-before" : ""}${dropAt === i + 1 && i === count - 1 ? " drop-after" : ""}`}
            draggable={!busy}
            onDragStart={(e) => onDragStart(e, i)}
            onDragOver={(e) => onDragOver(e, i)}
            onDragEnd={() => {
              dragging.current = null;
              setDropAt(null);
            }}
            onClick={(e) => select(i, e)}
            onDoubleClick={() => wb.setOrganize(documentId, false, i)}
          >
            <Thumb documentId={documentId} index={i} />
            <span className="grid-label">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Act({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="tool"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} />
    </button>
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
