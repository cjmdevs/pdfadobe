// Bookmark editor (Bookmarks tab of the navigation pane).
// - Add from the current view (named after the selected text, if any), rename (F2 or
//   double-click), delete, set destination, expand/collapse, auto-bookmark every page.
// - Drag to reorder or nest. With "Move pages with bookmarks" on (default), dragging a
//   bookmark also moves its pages and child bookmarks to the new position.
// - Delete or extract a bookmark together with its pages.
// Every change is one undoable step.
import { useEffect, useState, type KeyboardEvent } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useBookmarkCapability } from "@embedpdf/plugin-bookmark/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { PdfZoomMode, type PdfBookmarkObject } from "@embedpdf/models";
import {
  bookmark,
  flatten,
  insertAt,
  moveNode,
  nodeAt,
  pageTarget,
  perPageOutline,
  removeAt,
  samePath,
  targetPage,
  titleFromFileName,
  updateAt,
  withPage,
  type Outline,
  type OutlinePath,
} from "../engine/pages";
import { pageOp } from "../app/pages";
import { useNav } from "../app/useNav";
import { useWorkbench } from "../app/workbench";
import { Icon, type IconName } from "./Icon";
import { usePointerDrag } from "./usePointerDrag";

type Drop = { path: OutlinePath; zone: "before" | "after" | "inside" };

const key = (p: OutlinePath) => p.join(".");

export function BookmarkPanel({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const nav = useNav(documentId);
  const { provides: scroll } = useScroll(documentId);
  const { provides: selection } = useSelectionCapability();
  const doc = useDocumentState(documentId)?.document ?? null;
  const bytes = wb.docBytes(documentId);
  const [outline, setOutline] = useState<Outline | null>(null);
  const selected = wb.meta[documentId]?.bookmark ?? null;
  const setSelected = (path: OutlinePath | null) => wb.setSelectedBookmark(documentId, path);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<OutlinePath | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  // Pointer-event drag (see usePointerDrag). Handlers run at event time, after render.
  const drag = usePointerDrag<OutlinePath>({
    disabled: wb.busy !== null,
    onMove: (_from, under, e) => setDrop(dropAt(under, e.clientY)),
    onCancel: () => setDrop(null),
    onDrop: (from, under, e) => {
      setDrop(null);
      applyDrop(from, dropAt(under, e.clientY));
    },
  });
  const movePages = wb.settings.bookmarkDragMovesPages;

  useEffect(() => {
    if (!bytes) return;
    let live = true;
    pageOp("readOutline", bytes).then(
      (o) => {
        if (!live) return;
        setOutline(o);
        setOpen(new Set(o.map((_, i) => String(i))));
      },
      () => live && setOutline([]),
    );
    return () => {
      live = false;
    };
  }, [bytes]);

  if (!bytes) return <ReadOnlyBookmarks documentId={documentId} />;
  if (!outline || !doc) return <p className="muted pad">Loading…</p>;

  const busy = wb.busy !== null;
  const name = titleFromFileName(wb.meta[documentId]?.name ?? "Document");
  const save = (label: string, next: Outline) =>
    void wb.edit(documentId, label, (b) => pageOp("writeOutline", b, next), { page: nav.page });

  /** The visible top of the current page as an XYZ destination (zoom unchanged). */
  const currentView = () => {
    // Live scroll metrics (React state can trail a jump by a frame); Single Page mode
    // keeps its page in the workbench.
    const m = wb.settings.viewMode === "single" ? undefined : scroll?.getMetrics();
    const page = m ? Math.max(0, m.currentPage - 1) : nav.page;
    const vis = m?.pageVisibilityMetrics.find((v) => v.pageNumber === page + 1);
    const p = doc.pages[page];
    if (!vis || !p || p.rotation !== 0) return pageTarget(page);
    return pageTarget(page, { x: 0, y: Math.round(p.size.height - vis.original.pageY), zoom: 0 });
  };

  const goTo = (b: PdfBookmarkObject) => {
    const page = targetPage(b);
    if (page === null) return;
    const t = b.target;
    const d =
      t?.type === "destination"
        ? t.destination
        : t?.type === "action" && "destination" in t.action
          ? t.action.destination
          : null;
    const p = doc.pages[page];
    if (
      d?.zoom.mode === PdfZoomMode.XYZ &&
      p &&
      p.rotation === 0 &&
      wb.settings.viewMode !== "single" &&
      // An XYZ "top" of null (keep position) reads as 0 here: treat it as the page top.
      d.zoom.params.y > 0 &&
      d.zoom.params.y < p.size.height
    ) {
      scroll?.scrollToPage({
        pageNumber: page + 1,
        pageCoordinates: { x: 0, y: p.size.height - d.zoom.params.y },
        alignX: 0,
        alignY: 0,
        behavior: "instant",
      });
    } else nav.goTo(page);
  };

  /** New bookmark at the current view: "Untitled", or named after the selected text. */
  const add = async (fromSelection: boolean) => {
    let title = "Untitled";
    if (fromSelection) {
      const text = await selection
        ?.getSelectedText()
        .toPromise()
        .then((t) => t.join(" ").replace(/\s+/g, " ").trim().slice(0, 200))
        .catch(() => "");
      if (!text) {
        wb.toast("Select text on the page first, then choose New bookmark from selection.");
        return;
      }
      title = text;
    }
    const node: PdfBookmarkObject = { title, target: currentView(), children: [] };
    // After the selected bookmark (same level), else at the end.
    const parent = selected ? selected.slice(0, -1) : [];
    const index = selected ? (selected[selected.length - 1] ?? 0) + 1 : outline.length;
    setSelected([...parent, index]);
    save("Add bookmark", insertAt(outline, parent, index, node));
  };

  const rename = (path: OutlinePath, title: string) => {
    setRenaming(null);
    const t = title.trim();
    if (!t || t === nodeAt(outline, path).title) return;
    save(
      "Rename bookmark",
      updateAt(outline, path, (n) => ({ ...n, title: t })),
    );
  };

  const withPages = async (what: "delete" | "extract", path: OutlinePath) => {
    const pages = await pageOp("bookmarkPages", bytes, path).catch((e: unknown) => {
      wb.toast(e instanceof Error ? e.message : String(e), "error");
      return null;
    });
    if (!pages) return;
    const title = nodeAt(outline, path).title;
    const range =
      pages.length === 1
        ? `page ${(pages[0] ?? 0) + 1}`
        : `pages ${(pages[0] ?? 0) + 1}-${(pages[pages.length - 1] ?? 0) + 1}`;
    if (what === "delete") {
      const yes = await wb.confirm({
        title: "Delete bookmark and pages",
        message: `Delete “${title}” and its ${pages.length} page(s) (${range})? You can undo this.`,
        ok: "Delete",
        danger: true,
      });
      if (!yes) return;
      setSelected(null);
      void wb.edit(
        documentId,
        "Delete bookmark and pages",
        (b) => pageOp("deleteBookmarkWithPages", b, path),
        {
          page: Math.max(0, (pages[0] ?? 0) - 1),
        },
      );
    } else {
      try {
        const out = await pageOp("extractBookmarkPages", bytes, path);
        wb.openNew(`${name} - ${title.replace(/[<>:"/\\|?*]/g, "_")}.pdf`, out);
      } catch (e) {
        wb.toast(`Extract failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    }
  };

  /** Row under the pointer and zone: top 30% before, bottom 30% after, else inside. */
  function dropAt(under: Element | null, y: number): Drop | null {
    const rowEl = under?.closest<HTMLElement>("[data-path]");
    if (!rowEl?.dataset.path) return null;
    const path = rowEl.dataset.path.split(".").map(Number);
    const r = rowEl.getBoundingClientRect();
    const f = (y - r.top) / r.height;
    return { path, zone: f < 0.3 ? "before" : f > 0.7 ? "after" : "inside" };
  }

  function applyDrop(from: OutlinePath, d: Drop | null) {
    if (!outline || !d || samePath(from, d.path) || isUnder(d.path, from)) return;
    const toParent = d.zone === "inside" ? d.path : d.path.slice(0, -1);
    const last = d.path[d.path.length - 1] ?? 0;
    const index =
      d.zone === "inside"
        ? (nodeAt(outline, d.path).children?.length ?? 0)
        : d.zone === "before"
          ? last
          : last + 1;
    if (d.zone === "inside") setOpen((o) => new Set(o).add(key(d.path)));
    if (movePages) {
      void wb.edit(documentId, "Move bookmark and pages", (b) =>
        pageOp("moveBookmarkWithPages", b, from, toParent, index),
      );
    } else {
      save("Move bookmark", moveNode(outline, from, toParent, index).outline);
    }
  }

  const onKey = (e: KeyboardEvent, path: OutlinePath, b: PdfBookmarkObject) => {
    const kids = b.children?.length ?? 0;
    if (e.key === "F2") setRenaming(path);
    else if (e.key === "Delete") {
      setSelected(null);
      save("Delete bookmark", removeAt(outline, path));
    } else if (kids && (e.key === "ArrowRight" || e.key === "+"))
      setOpen((o) => new Set(o).add(key(path)));
    else if (kids && (e.key === "ArrowLeft" || e.key === "-"))
      setOpen((o) => {
        const n = new Set(o);
        n.delete(key(path));
        return n;
      });
    else if (e.key === "Enter" || e.key === " ") goTo(b);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const sel = selected;
  const tool = (icon: IconName, label: string, onClick: () => void, needsSel = true) => (
    <button
      type="button"
      className="tool small"
      aria-label={label}
      title={label}
      disabled={busy || (needsSel && !sel)}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
    </button>
  );

  const render = (items: Outline, base: OutlinePath, level: number) =>
    items.map((b, i) => {
      const path = [...base, i];
      const k = key(path);
      const kids = b.children ?? [];
      const isOpen = open.has(k);
      const page = targetPage(b);
      const dz = drop && samePath(drop.path, path) ? ` drop-${drop.zone}` : "";
      return (
        <li
          key={k}
          role="treeitem"
          aria-expanded={kids.length ? isOpen : undefined}
          aria-level={level}
          aria-selected={sel ? samePath(sel, path) : false}
        >
          <div
            className={`tree-row${sel && samePath(sel, path) ? " selected" : ""}${dz}`}
            style={{ paddingLeft: (level - 1) * 14 }}
            data-testid="bookmark"
            data-path={k}
            onPointerDown={(e) => renaming === null && drag.start(e, path)}
          >
            {kids.length ? (
              <button
                type="button"
                className="twisty"
                aria-label={isOpen ? "Collapse" : "Expand"}
                tabIndex={-1}
                onClick={() =>
                  setOpen((o) => {
                    const n = new Set(o);
                    if (n.has(k)) n.delete(k);
                    else n.add(k);
                    return n;
                  })
                }
              >
                {isOpen ? "▾" : "▸"}
              </button>
            ) : (
              <span className="twisty" />
            )}
            {renaming && samePath(renaming, path) ? (
              <input
                className="tree-rename"
                aria-label="Bookmark name"
                defaultValue={b.title}
                autoFocus
                onFocus={(e) => e.target.select()}
                onBlur={(e) => rename(path, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename(path, e.currentTarget.value);
                  else if (e.key === "Escape") setRenaming(null);
                  e.stopPropagation();
                }}
              />
            ) : (
              <button
                type="button"
                className="tree-label"
                onKeyDown={(e) => onKey(e, path, b)}
                onClick={() => {
                  setSelected(path);
                  goTo(b);
                }}
                onDoubleClick={() => setRenaming(path)}
                title={page !== null ? `Page ${page + 1}` : "No destination"}
              >
                {b.title}
              </button>
            )}
          </div>
          {isOpen && kids.length > 0 && <ul role="group">{render(kids, path, level + 1)}</ul>}
        </li>
      );
    });

  return (
    <div className="bookmarks">
      {/* Like docs/reference/acrobat-workspace.png: options menu, delete, new bookmark,
          new bookmark from selection. Less common actions live in the options menu. */}
      <div className="bm-tools" role="toolbar" aria-label="Bookmarks">
        <BookmarkMenu
          disabled={busy}
          hasSelection={sel !== null}
          movePages={movePages}
          items={{
            expand: () => setOpen(new Set(flatten(outline).map((f) => key(f.path)))),
            collapse: () => setOpen(new Set()),
            rename: () => sel && setRenaming(sel),
            setDestination: () =>
              sel &&
              save(
                "Set bookmark destination",
                updateAt(outline, sel, (n) => ({ ...n, target: currentView() })),
              ),
            deletePages: () => sel && void withPages("delete", sel),
            extract: () => sel && void withPages("extract", sel),
            perPage: () => {
              const go = () => save("Bookmark every page", perPageOutline(doc.pageCount));
              if (!outline.length) return go();
              void wb
                .confirm({
                  title: "Bookmark every page",
                  message: "Replace all bookmarks with one bookmark per page? You can undo this.",
                  ok: "Replace",
                })
                .then((yes) => yes && go());
            },
            toggleMovePages: () => wb.updateSettings({ bookmarkDragMovesPages: !movePages }),
          }}
        />
        <span className="sep" />
        {tool("trash", "Delete bookmark (Del)", () => {
          if (!sel) return;
          setSelected(null);
          save("Delete bookmark", removeAt(outline, sel));
        })}
        {tool("bookmarkAdd", "New bookmark (current view)", () => void add(false), false)}
        {tool(
          "bookmarkFromSelection",
          "New bookmark from selected text",
          () => void add(true),
          false,
        )}
      </div>
      {outline.length === 0 ? (
        <p className="muted pad">This document has no bookmarks. Use New bookmark to add one.</p>
      ) : (
        <ul className="tree" role="tree" aria-label="Bookmarks">
          {render(outline, [], 1)}
        </ul>
      )}
    </div>
  );
}

function isUnder(path: OutlinePath, ancestor: OutlinePath): boolean {
  return path.length > ancestor.length && ancestor.every((v, i) => path[i] === v);
}

interface MenuItems {
  expand(): void;
  collapse(): void;
  rename(): void;
  setDestination(): void;
  deletePages(): void;
  extract(): void;
  perPage(): void;
  toggleMovePages(): void;
}

function BookmarkMenu({
  disabled,
  hasSelection,
  movePages,
  items,
}: {
  disabled: boolean;
  hasSelection: boolean;
  movePages: boolean;
  items: MenuItems;
}) {
  const [open, setOpen] = useState(false);
  const item = (label: string, fn: () => void, needsSelection = false) => (
    <button
      type="button"
      role="menuitem"
      disabled={needsSelection && !hasSelection}
      onClick={() => {
        setOpen(false);
        fn();
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="menu-wrap">
      <button
        type="button"
        className="tool small menu-button"
        aria-label="Bookmark options"
        title="Bookmark options"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Icon name="options" size={16} />
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="menu left" role="menu">
          {item("Rename (F2)", items.rename, true)}
          {item("Set destination to current view", items.setDestination, true)}
          {item("Delete bookmark and its pages…", items.deletePages, true)}
          {item("Extract bookmark's pages to new file", items.extract, true)}
          <hr />
          {item("Expand all", items.expand)}
          {item("Collapse all", items.collapse)}
          {item("Bookmark every page", items.perPage)}
          <hr />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={movePages}
            onClick={() => {
              setOpen(false);
              items.toggleMovePages();
            }}
          >
            {movePages ? "✓ " : ""}Dragging a bookmark moves its pages
          </button>
        </div>
      )}
    </div>
  );
}

/** Password-protected documents: bookmarks are shown (via EmbedPDF) but not editable. */
function ReadOnlyBookmarks({ documentId }: { documentId: string }) {
  const { provides } = useBookmarkCapability();
  const nav = useNav(documentId);
  const [items, setItems] = useState<Outline | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!provides) return;
    let live = true;
    provides
      .forDocument(documentId)
      .getBookmarks()
      .wait(
        (r) => {
          if (!live) return;
          setItems(r.bookmarks);
          setOpen(new Set(r.bookmarks.map((_, i) => String(i))));
        },
        () => live && setItems([]),
      );
    return () => {
      live = false;
    };
  }, [provides, documentId]);
  if (items === null) return <p className="muted pad">Loading…</p>;
  if (items.length === 0) return <p className="muted pad">This document has no bookmarks.</p>;
  const render = (list: Outline, base: OutlinePath, level: number) =>
    list.map((b, i) => {
      const path = [...base, i];
      const k = key(path);
      const kids = b.children ?? [];
      const isOpen = open.has(k);
      const page = targetPage(b);
      const toggle = () =>
        setOpen((o) => {
          const n = new Set(o);
          if (n.has(k)) n.delete(k);
          else n.add(k);
          return n;
        });
      return (
        <li
          key={k}
          role="treeitem"
          aria-expanded={kids.length ? isOpen : undefined}
          aria-level={level}
        >
          <div className="tree-row" style={{ paddingLeft: (level - 1) * 14 }}>
            {kids.length ? (
              <button
                type="button"
                className="twisty"
                aria-label={isOpen ? "Collapse" : "Expand"}
                tabIndex={-1}
                onClick={toggle}
              >
                {isOpen ? "▾" : "▸"}
              </button>
            ) : (
              <span className="twisty" />
            )}
            <button
              type="button"
              className="tree-label"
              onClick={() => page !== null && nav.goTo(page)}
            >
              {b.title}
            </button>
          </div>
          {isOpen && kids.length > 0 && <ul role="group">{render(kids, path, level + 1)}</ul>}
        </li>
      );
    });
  return (
    <>
      <p className="muted small pad">Password-protected: bookmarks are read-only.</p>
      <ul className="tree" role="tree" aria-label="Bookmarks">
        {render(items, [], 1)}
      </ul>
    </>
  );
}

export { bookmark, withPage };
