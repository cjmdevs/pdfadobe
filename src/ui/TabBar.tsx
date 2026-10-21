import {
  useActiveDocument,
  useDocumentManagerCapability,
  useOpenDocuments,
} from "@embedpdf/plugin-document-manager/react";
import { useWorkbench } from "../app/workbench";
import { Icon } from "./Icon";

export function TabBar() {
  const docs = useOpenDocuments();
  const { activeDocumentId } = useActiveDocument();
  const { provides: manager } = useDocumentManagerCapability();
  const { meta, closeDocument } = useWorkbench();
  if (docs.length === 0) return null;
  return (
    <div className="tabbar" role="tablist" aria-label="Open documents">
      {docs.map((d) => {
        const m = meta[d.id];
        const name = m?.name ?? d.name ?? "Untitled";
        const title = m?.source.kind === "path" ? m.source.path : name;
        const active = d.id === activeDocumentId;
        return (
          <div
            key={d.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`tab${active ? " active" : ""}${d.status === "error" ? " error" : ""}`}
            title={title}
            onClick={() => manager?.setActiveDocument(d.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeDocument(d.id);
            }}
          >
            <Icon name="file" size={14} />
            <span className="tab-name">{name}</span>
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
    </div>
  );
}
