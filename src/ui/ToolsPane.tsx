// Right-hand Tools pane (backlog B4): search box and the list of tools from the registry.
// Clicking a tool opens its toolbar above the page (or runs it, e.g. Combine Files).
// Tools that are not built yet are hidden unless "Show tools that are coming later" is on.
import { lazy, Suspense, useState, type ReactNode } from "react";
import { TOOLS, comingLabel, isBuilt, type ToolContext, type ToolDef } from "../tools/registry";
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
  const { settings, updateSettings, meta, setActiveTool } = ctx.wb;
  const [query, setQuery] = useState("");
  const active = ctx.documentId ? meta[ctx.documentId]?.activeTool : null;
  const panel = active && ctx.documentId ? PANELS.get(active)?.(ctx.documentId) : null;
  const shown = TOOLS.filter(
    (t) => !t.unlisted && (isBuilt(t) || settings.showComingTools) && matches(t, query),
  );

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
      {panel && <Suspense fallback={null}>{panel}</Suspense>}
      <ul className="tool-list">
        {shown.map((t) => {
          const built = isBuilt(t);
          const needsDoc = t.needsDocument !== false;
          const disabled = !built || (needsDoc && !ctx.documentId);
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`tool-item${active === t.id ? " active" : ""}`}
                aria-pressed={t.open === "toolbar" ? active === t.id : undefined}
                aria-label={t.name}
                disabled={disabled}
                title={built ? t.description : `${t.description}. ${comingLabel(t)}.`}
                onClick={() => open(t)}
              >
                <span className="tool-icon" style={{ color: built ? t.color : undefined }}>
                  <Icon name={t.icon} />
                </span>
                <span className="tool-name">
                  {t.name}
                  {!built && <span className="tool-coming">{comingLabel(t)}</span>}
                </span>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="muted pad">No tools match.</li>}
      </ul>
      <label className="tools-option small">
        <input
          type="checkbox"
          checked={settings.showComingTools}
          onChange={(e) => updateSettings({ showComingTools: e.target.checked })}
        />{" "}
        Show tools that are coming later
      </label>
    </aside>
  );
}
