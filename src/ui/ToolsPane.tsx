// Right-hand Tools pane (backlog B4): search box and the list of tools from the registry.
// Clicking a tool opens its toolbar above the page (or runs it, e.g. Combine Files).
import { lazy, Suspense, useState, type ReactNode } from "react";
import { TOOLS, type ToolContext, type ToolDef } from "../tools/registry";
import { useDocToolContext, useNoDocToolContext } from "../tools/useToolContext";
import { Icon } from "./Icon";

export function ToolsPane({ documentId }: { documentId: string | null }) {
  return documentId ? <DocToolsPane documentId={documentId} /> : <NoDocToolsPane />;
}

function DocToolsPane({ documentId }: { documentId: string }) {
  return <Pane ctx={useDocToolContext(documentId)} />;
}

function NoDocToolsPane() {
  return <Pane ctx={useNoDocToolContext()} />;
}

/** Each tool's panel, made once (React.lazy must not be re-created per render). */
const PANELS = new Map<string, (documentId: string) => ReactNode>(
  TOOLS.flatMap((t) => {
    if (!t.panel) return [];
    const Lazy = lazy(t.panel);
    return [[t.id, (documentId: string) => <Lazy documentId={documentId} />] as const];
  }),
);

function matches(t: ToolDef, q: string): boolean {
  const s = q.trim().toLowerCase();
  return !s || t.name.toLowerCase().includes(s) || t.description.toLowerCase().includes(s);
}

function Pane({ ctx }: { ctx: ToolContext }) {
  const { updateSettings, meta, setActiveTool } = ctx.wb;
  const [query, setQuery] = useState("");
  const active = ctx.documentId ? meta[ctx.documentId]?.activeTool : null;
  const panel = active && ctx.documentId ? PANELS.get(active)?.(ctx.documentId) : null;
  const shown = TOOLS.filter((t) => !t.unlisted && matches(t, query));

  const open = (t: ToolDef) => {
    if (t.open !== "toolbar") return t.open(ctx);
    if (!ctx.documentId) return;
    setActiveTool(ctx.documentId, active === t.id ? null : t.id, ctx.pages[0]);
  };

  return (
    <aside className="tools-pane" aria-label="Tools pane">
      <header className="panel-head">
        <input
          type="search"
          className="tools-search"
          aria-label="Search tools"
          placeholder="Search tools"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="tool small"
          aria-label="Hide tools pane"
          title="Hide tools pane"
          onClick={() => updateSettings({ toolsPaneOpen: false })}
        >
          <Icon name="chevronRight" size={16} />
        </button>
      </header>
      {panel && (
        <div className="tool-panel-host">
          <Suspense fallback={null}>{panel}</Suspense>
        </div>
      )}
      <ul className="tool-list">
        {shown.map((t) => {
          const needsDoc = t.needsDocument !== false;
          const disabled = needsDoc && !ctx.documentId;
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`tool-item${active === t.id ? " active" : ""}`}
                aria-pressed={t.open === "toolbar" ? active === t.id : undefined}
                aria-label={t.name}
                disabled={disabled}
                title={t.description}
                onClick={() => open(t)}
              >
                <span className="tool-icon" style={{ color: t.color }}>
                  <Icon name={t.icon} />
                </span>
                <span className="tool-name">{t.name}</span>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="muted pad">No tools match.</li>}
      </ul>
    </aside>
  );
}
