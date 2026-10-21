// Left navigation pane: page thumbnails, bookmarks (outline), attachments.
import { useEffect, useState, type KeyboardEvent } from "react";
import { useAttachmentCapability } from "@embedpdf/plugin-attachment/react";
import { useBookmarkCapability } from "@embedpdf/plugin-bookmark/react";
import { ThumbImg, ThumbnailsPane } from "@embedpdf/plugin-thumbnail/react";
import { PdfActionType, type PdfAttachmentObject, type PdfBookmarkObject } from "@embedpdf/models";
import type { SidebarTab } from "../app/settings";
import { useNav } from "../app/useNav";
import { useWorkbench } from "../app/workbench";
import { formatFileSize } from "../engine/properties";
import { platform } from "../platform";

const TABS: { id: SidebarTab; label: string }[] = [
  { id: "thumbnails", label: "Pages" },
  { id: "outline", label: "Bookmarks" },
  { id: "attachments", label: "Attachments" },
];

export function Sidebar({ documentId }: { documentId: string }) {
  const { settings, updateSettings } = useWorkbench();
  const tab = settings.sidebarTab;
  return (
    <aside className="sidebar" aria-label="Navigation pane" id="nav-pane">
      <div className="sidebar-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => updateSettings({ sidebarTab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="sidebar-body"
        role="tabpanel"
        aria-label={TABS.find((t) => t.id === tab)?.label}
      >
        {tab === "thumbnails" && <Thumbnails documentId={documentId} />}
        {tab === "outline" && <Outline documentId={documentId} />}
        {tab === "attachments" && <Attachments documentId={documentId} />}
      </div>
    </aside>
  );
}

function Thumbnails({ documentId }: { documentId: string }) {
  const nav = useNav(documentId);
  return (
    <ThumbnailsPane documentId={documentId} className="thumbs" style={{ height: "100%" }}>
      {(m: {
        pageIndex: number;
        top: number;
        wrapperHeight: number;
        width: number;
        height: number;
        labelHeight: number;
      }) => (
        <button
          key={m.pageIndex}
          type="button"
          className={`thumb${m.pageIndex === nav.page ? " current" : ""}`}
          aria-label={`Page ${m.pageIndex + 1}`}
          aria-current={m.pageIndex === nav.page ? "page" : undefined}
          data-testid="thumb"
          style={{ position: "absolute", top: m.top, height: m.wrapperHeight, left: 0, right: 0 }}
          onClick={() => nav.goTo(m.pageIndex)}
        >
          <span className="thumb-frame" style={{ width: m.width, height: m.height }}>
            <ThumbImg documentId={documentId} meta={m as never} />
          </span>
          <span className="thumb-label" style={{ height: m.labelHeight }}>
            {m.pageIndex + 1}
          </span>
        </button>
      )}
    </ThumbnailsPane>
  );
}

function targetPage(b: PdfBookmarkObject): number | null {
  const t = b.target;
  if (!t) return null;
  if (t.type === "destination") return t.destination.pageIndex;
  if (t.action.type === PdfActionType.Goto) return t.action.destination.pageIndex;
  return null;
}

function Outline({ documentId }: { documentId: string }) {
  const { provides } = useBookmarkCapability();
  const [items, setItems] = useState<PdfBookmarkObject[] | null>(null);
  useEffect(() => {
    if (!provides) return;
    let live = true;
    provides
      .forDocument(documentId)
      .getBookmarks()
      .wait(
        (r) => live && setItems(r.bookmarks),
        () => live && setItems([]),
      );
    return () => {
      live = false;
    };
  }, [provides, documentId]);

  if (items === null) return <p className="muted pad">Loading…</p>;
  if (items.length === 0) return <p className="muted pad">This document has no bookmarks.</p>;
  return (
    <ul className="tree" role="tree" aria-label="Bookmarks">
      {items.map((b, i) => (
        <OutlineNode key={i} item={b} documentId={documentId} level={1} />
      ))}
    </ul>
  );
}

function OutlineNode({
  item,
  documentId,
  level,
}: {
  item: PdfBookmarkObject;
  documentId: string;
  level: number;
}) {
  const nav = useNav(documentId);
  const [open, setOpen] = useState(level === 1);
  const kids = item.children ?? [];
  const page = targetPage(item);
  // Adobe: Right/Shift+Plus expands, Left/Minus collapses (focus on Bookmarks panel).
  const onKey = (e: KeyboardEvent) => {
    if (kids.length && (e.key === "ArrowRight" || e.key === "+")) setOpen(true);
    else if (kids.length && (e.key === "ArrowLeft" || e.key === "-")) setOpen(false);
    else if ((e.key === "Enter" || e.key === " ") && page !== null) nav.goTo(page);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <li role="treeitem" aria-expanded={kids.length ? open : undefined} aria-level={level}>
      <div className="tree-row" style={{ paddingLeft: (level - 1) * 14 }}>
        {kids.length ? (
          <button
            type="button"
            className="twisty"
            aria-label={open ? "Collapse" : "Expand"}
            tabIndex={-1}
            onClick={() => setOpen(!open)}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="twisty" />
        )}
        <button
          type="button"
          className="tree-label"
          onKeyDown={onKey}
          onClick={() => page !== null && nav.goTo(page)}
          title={page !== null ? `Page ${page + 1}` : undefined}
        >
          {item.title}
        </button>
      </div>
      {open && kids.length > 0 && (
        <ul role="group">
          {kids.map((k, i) => (
            <OutlineNode key={i} item={k} documentId={documentId} level={level + 1} />
          ))}
        </ul>
      )}
    </li>
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
