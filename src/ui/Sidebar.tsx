// Left side (backlog B4): an icon rail (Pages, Bookmarks, Attachments) and the panel it
// opens, with a title and a close button, like docs/reference/acrobat-workspace.png.
// F4 shows/hides the panel; clicking the open panel's icon closes it.
import { useEffect, useState } from "react";
import { useAttachmentCapability } from "@embedpdf/plugin-attachment/react";
import { ThumbImg, ThumbnailsPane } from "@embedpdf/plugin-thumbnail/react";
import type { PdfAttachmentObject } from "@embedpdf/models";
import type { SidebarTab } from "../app/settings";
import { useNav } from "../app/useNav";
import { useWorkbench } from "../app/workbench";
import { formatFileSize } from "../engine/properties";
import { platform } from "../platform";
import { BookmarkPanel } from "./BookmarkPanel";
import { Icon, type IconName } from "./Icon";

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
