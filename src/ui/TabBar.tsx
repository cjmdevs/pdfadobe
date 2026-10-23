// Document tabs. Drag a tab along the bar to reorder it; in the Windows app, drag it out
// of the window to move it to the window under the pointer or to a new window there, or
// right-click > Move to New Window (backlog B1).
import { useEffect, useState } from "react";
import {
  useActiveDocument,
  useDocumentManagerCapability,
  useOpenDocuments,
} from "@embedpdf/plugin-document-manager/react";
import { useWorkbench } from "../app/workbench";
import { platform } from "../platform";
import { Icon } from "./Icon";
import { usePointerDrag } from "./usePointerDrag";

const outsideWindow = (e: PointerEvent) =>
  e.clientX < 0 ||
  e.clientY < 0 ||
  e.clientX >= window.innerWidth ||
  e.clientY >= window.innerHeight;

export function TabBar() {
  const docs = useOpenDocuments();
  const { activeDocumentId } = useActiveDocument();
  const { provides: manager } = useDocumentManagerCapability();
  const { meta, closeDocument, editState, dropTabOutside, moveToNewWindow } = useWorkbench();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);

  const drag = usePointerDrag<string>({
    onMove(_id, under, e) {
      const tab = under?.closest<HTMLElement>(".tab[data-doc]");
      if (!tab?.dataset.doc) return setOver(null);
      const r = tab.getBoundingClientRect();
      setOver({ id: tab.dataset.doc, after: e.clientX > r.left + r.width / 2 });
    },
    onDrop(id, under, e) {
      setOver(null);
      if (outsideWindow(e)) {
        if (platform.windows) void dropTabOutside(id);
        return;
      }
      const tab = under?.closest<HTMLElement>(".tab[data-doc]");
      const target = tab?.dataset.doc;
      if (!manager || !target || target === id) return;
      const order = manager.getDocumentOrder().filter((d) => d !== id);
      const at = order.indexOf(target);
      const r = tab.getBoundingClientRect();
      manager.moveDocument(id, at + (e.clientX > r.left + r.width / 2 ? 1 : 0));
    },
    onCancel: () => setOver(null),
  });

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.target instanceof Element && e.target.closest(".tab-menu")) return;
      setMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  if (docs.length === 0) return null;
  return (
    <div className="tabbar" role="tablist" aria-label="Open documents">
      {docs.map((d) => {
        const m = meta[d.id];
        const name = m?.name ?? d.name ?? "Untitled";
        const title = m?.source.kind === "path" ? m.source.path : name;
        const active = d.id === activeDocumentId;
        const mark = over?.id === d.id && drag.source !== d.id;
        return (
          <div
            key={d.id}
            data-doc={d.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`tab${active ? " active" : ""}${d.status === "error" ? " error" : ""}${
              drag.source === d.id ? " dragging" : ""
            }${mark ? (over.after ? " drop-after" : " drop-before") : ""}`}
            title={title}
            onPointerDown={(e) => {
              if (!(e.target as Element).closest(".tab-close")) drag.start(e, d.id);
            }}
            onClick={() => manager?.setActiveDocument(d.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeDocument(d.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              manager?.setActiveDocument(d.id);
              setMenu({ id: d.id, x: e.clientX, y: e.clientY });
            }}
          >
            <Icon name="file" size={14} />
            <span className="tab-name">{name}</span>
            {editState(d.id).dirty && (
              <span className="tab-dirty" title="Unsaved changes" aria-label="Unsaved changes">
                •
              </span>
            )}
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${name}`}
              onClick={(e) => {
                e.stopPropagation();
                closeDocument(d.id);
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}
      {menu && (
        <div
          className="menu tab-menu"
          role="menu"
          aria-label="Tab menu"
          style={{ position: "fixed", left: menu.x, top: menu.y, right: "auto" }}
        >
          {platform.windows && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                void moveToNewWindow(menu.id);
              }}
            >
              Move to New Window
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(null);
              closeDocument(menu.id);
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
