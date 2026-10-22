// Left navigation pane: page thumbnails, bookmarks (outline), attachments.
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
        {tab === "outline" && <BookmarkPanel documentId={documentId} />}
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
