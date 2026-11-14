// Left side (backlog B4): an icon rail (Pages, Bookmarks, Attachments) and the panel it
// opens, with a title and a close button, like docs/reference/acrobat-workspace.png.
// F4 shows/hides the panel; clicking the open panel's icon closes it.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAttachmentCapability } from "@embedpdf/plugin-attachment/react";
import { ThumbImg, ThumbnailsPane, useThumbnailCapability } from "@embedpdf/plugin-thumbnail/react";
import type { PdfAttachmentObject } from "@embedpdf/models";
import type { SidebarTab } from "../app/settings";
import { usePageActions } from "../app/pageActions";
import { useNav } from "../app/useNav";
import { useWorkbench } from "../app/workbench";
import { formatFileSize } from "../engine/properties";
import { platform } from "../platform";
import { BookmarkPanel } from "./BookmarkPanel";
import { Icon, type IconName } from "./Icon";
import { ContextMenu, useContextMenu } from "./kit/Menu";
import { DragGhost, autoScroll } from "./kit/DragFeedback";
import { usePageCommands } from "./pageMenu";
import { usePointerDrag } from "./usePointerDrag";

const TABS: { id: SidebarTab; label: string; icon: IconName }[] = [
  { id: "thumbnails", label: "Pages", icon: "pages" },
  { id: "outline", label: "Bookmarks", icon: "bookmark" },
  { id: "attachments", label: "Attachments", icon: "paperclip" },
];

export function Sidebar({ documentId }: { documentId: string }) {
  const { settings, updateSettings } = useWorkbench();
  const tab = settings.sidebarTab;
  const open = settings.sidebarOpen;
  const current = TABS.find((t) => t.id === tab);
  return (
    <div className="left-dock" id="nav-pane">
      <div className="rail" role="tablist" aria-orientation="vertical" aria-label="Navigation rail">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-label={t.label}
            title={t.label}
            aria-selected={open && tab === t.id}
            className={open && tab === t.id ? "active" : ""}
            onClick={() =>
              open && tab === t.id
                ? updateSettings({ sidebarOpen: false })
                : updateSettings({ sidebarTab: t.id, sidebarOpen: true })
            }
          >
            <Icon name={t.icon} />
          </button>
        ))}
      </div>
      {open && (
        <aside className="sidebar" aria-label="Navigation pane">
          <header className="panel-head">
            <h2>{current?.label}</h2>
            <button
              type="button"
              className="tool small"
              aria-label="Close pane (F4)"
              title="Close pane (F4)"
              onClick={() => updateSettings({ sidebarOpen: false })}
            >
              <Icon name="close" size={16} />
            </button>
          </header>
          <div className="sidebar-body" role="tabpanel" aria-label={current?.label}>
            {tab === "thumbnails" && <Thumbnails documentId={documentId} />}
            {tab === "outline" && <BookmarkPanel documentId={documentId} />}
            {tab === "attachments" && <Attachments documentId={documentId} />}
          </div>
        </aside>
      )}
    </div>
  );
}

/**
 * Pages panel (B8): click goes to the page and selects it, Ctrl+click adds or removes,
 * Shift+click selects a run (Enter also goes to the focused page). One outline marks the
 * selected pages (the current page when none are). Right-click opens the page menu; Ctrl+C / X /
 * V and Delete act on the selection; drag moves the selected pages, with a see-through
 * preview and an insertion line. The selection is the tab's page selection, shared with
 * the Organize grid.
 */
function Thumbnails({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const nav = useNav(documentId);
  const actions = usePageActions(documentId);
  const { provides: thumbs } = useThumbnailCapability();
  const count = nav.pageCount;
  const stored = wb.meta[documentId]?.pageSelection;
  const selected = useMemo(() => new Set(stored ?? []), [stored]);
  const sel = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  const setSelected = (next: Iterable<number>) =>
    wb.setPageSelection(
      documentId,
      [...new Set(next)].filter((i) => i >= 0 && i < count).sort((a, b) => a - b),
    );
  const [anchor, setAnchor] = useState(nav.page);
  const [focus, setFocus] = useState(nav.page);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [ghost, setGhost] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const cmds = usePageCommands(documentId, count, nav.page);
  const menu = useContextMenu<number[]>();
  const busy = wb.busy !== null;

  // The focus follows the page being read until the user picks pages here.
  useEffect(() => {
    if (!box.current?.contains(document.activeElement)) setFocus(nav.page);
  }, [nav.page]);

  const select = (i: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    setFocus(i);
    if (e.shiftKey) {
      const [a, b] = anchor <= i ? [anchor, i] : [i, anchor];
      const run = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      setSelected(e.ctrlKey || e.metaKey ? [...selected, ...run] : run);
      return;
    }
    setAnchor(i);
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      setSelected(next);
    } else setSelected([i]);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (cmds.onKey(e, sel)) return;
    const move = (to: number) => {
      const i = Math.max(0, Math.min(count - 1, to));
      select(i, { ctrlKey: false, metaKey: false, shiftKey: e.shiftKey });
      thumbs?.forDocument(documentId).scrollToThumb(i);
    };
    if (e.key === "ArrowDown") move(focus + 1);
    else if (e.key === "ArrowUp") move(focus - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(count - 1);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a")
      setSelected(Array.from({ length: count }, (_, i) => i));
    else if (e.key === "Enter") nav.goTo(focus);
    else if (e.key === "Escape" && sel.length) setSelected([]);
    else if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
      const el = box.current?.querySelector(`[data-page="${focus}"]`) ?? box.current;
      if (el) menu.openAt(el, sel.length ? sel : [focus]);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // Drop before the page under the pointer (upper half) or after it (lower half).
  const dropIndex = (under: Element | null, y: number): number | null => {
    const cell = under?.closest<HTMLElement>("[data-page]");
    if (!cell || !box.current?.contains(cell)) return null;
    const i = Number(cell.dataset.page);
    const r = cell.getBoundingClientRect();
    return y < r.top + r.height / 2 ? i : i + 1;
  };
  const drag = usePointerDrag<number[]>({
    disabled: busy,
    onMove: (_p, under, e) => {
      setDropAt(dropIndex(under, e.clientY));
      autoScroll(box.current?.querySelector(".thumbs") ?? null, e.clientY);
    },
    onCancel: () => setDropAt(null),
    onDrop: (pages, under, e) => {
      setDropAt(null);
      const at = dropIndex(under, e.clientY);
      if (at === null) return;
      const run = pages.every((p, k) => k === 0 || p === (pages[k - 1] ?? -2) + 1);
      if (run && at >= (pages[0] ?? 0) && at <= (pages.at(-1) ?? 0) + 1) return;
      void actions.move(pages, at >= count ? null : at);
    },
  });

  const optionId = (i: number) => `thumb-${documentId}-${i}`;
  return (
    <div
      ref={box}
      className="thumbs-box"
      role="listbox"
      aria-label="Pages"
      aria-multiselectable="true"
      aria-activedescendant={optionId(focus)}
      tabIndex={0}
      data-testid="thumbs"
      onKeyDown={onKey}
      onContextMenu={(e) => {
        if (!(e.target as Element).closest("[data-page]")) menu.open(e, []);
      }}
    >
      <ThumbnailsPane documentId={documentId} className="thumbs" style={{ height: "100%" }}>
        {(m: {
          pageIndex: number;
          top: number;
          wrapperHeight: number;
          width: number;
          height: number;
          labelHeight: number;
        }) => {
          const i = m.pageIndex;
          const on = selected.has(i);
          return (
            <div
              key={i}
              id={optionId(i)}
              role="option"
              aria-selected={on}
              aria-label={`Page ${i + 1}`}
              aria-current={i === nav.page ? "page" : undefined}
              data-page={i}
              data-testid="thumb"
              className={`thumb${on || (!sel.length && i === nav.page) ? " picked" : ""}${
                i === focus ? " focus" : ""
              }${drag.source?.includes(i) ? " dragging" : ""}${dropAt === i ? " drop-before" : ""}${
                dropAt === i + 1 && i === count - 1 ? " drop-after" : ""
              }`}
              style={{
                position: "absolute",
                top: m.top,
                height: m.wrapperHeight,
                left: 0,
                right: 0,
              }}
              onPointerDown={(e) => {
                const pages = on ? sel : [i];
                setGhost(e.currentTarget.querySelector("img")?.src ?? null);
                drag.start(e, pages);
              }}
              onClick={(e) => {
                box.current?.focus({ preventScroll: true });
                select(i, e);
                // A plain click also goes to the page (owner, B8); Ctrl / Shift only pick.
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) nav.goTo(i);
              }}
              onContextMenu={(e) => {
                box.current?.focus({ preventScroll: true });
                setFocus(i);
                // Right-click outside the selection picks just that page (like Acrobat).
                const pages = on ? sel : [i];
                if (!on) {
                  setAnchor(i);
                  setSelected([i]);
                }
                menu.open(e, pages);
              }}
            >
              <span className="thumb-frame" style={{ width: m.width, height: m.height }}>
                <ThumbImg documentId={documentId} meta={m as never} />
              </span>
              <span className="thumb-label" style={{ height: m.labelHeight }}>
                {i + 1}
              </span>
            </div>
          );
        }}
      </ThumbnailsPane>
      {drag.source && (
        <DragGhost pos={drag.pos} count={drag.source.length}>
          {ghost ? <img src={ghost} alt="" /> : <span>Page {(drag.source[0] ?? 0) + 1}</span>}
        </DragGhost>
      )}
      {menu.state && (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          label="Page menu"
          items={cmds.menu(menu.state.data)}
          onClose={menu.close}
        />
      )}
    </div>
  );
}

function Attachments({ documentId }: { documentId: string }) {
  const { provides } = useAttachmentCapability();
  const { openFiles, toast } = useWorkbench();
  const [items, setItems] = useState<PdfAttachmentObject[] | null>(null);
  useEffect(() => {
    if (!provides) return;
    let live = true;
    provides
      .forDocument(documentId)
      .getAttachments()
      .wait(
        (r) => live && setItems(r),
        () => live && setItems([]),
      );
    return () => {
      live = false;
    };
  }, [provides, documentId]);

  const fetchBytes = (a: PdfAttachmentObject) =>
    new Promise<ArrayBuffer>((resolve, reject) =>
      provides?.forDocument(documentId).downloadAttachment(a).wait(resolve, reject),
    );

  if (items === null) return <p className="muted pad">Loading…</p>;
  if (items.length === 0) return <p className="muted pad">This document has no attachments.</p>;
  return (
    <ul className="attachments" aria-label="Attachments">
      {items.map((a) => {
        const isPdf = a.mimeType === "application/pdf" || /\.pdf$/i.test(a.name);
        return (
          <li key={a.index} data-testid="attachment">
            <div className="att-name">{a.name}</div>
            <div className="muted small">
              {a.size !== undefined ? formatFileSize(a.size) : ""}
              {a.description ? ` · ${a.description}` : ""}
            </div>
            <div className="button-row">
              {isPdf && (
                <button
                  type="button"
                  onClick={() =>
                    void fetchBytes(a).then((bytes) =>
                      openFiles([
                        { source: { kind: "memory", name: a.name }, name: a.name, bytes },
                      ]),
                    )
                  }
                >
                  Open
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  void fetchBytes(a)
                    .then((bytes) => platform.saveAttachment(a.name, bytes))
                    .catch(() => toast(`Could not save ${a.name}`, "error"))
                }
              >
                Save…
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
