import { useEffect, useState } from "react";
import { ZoomMode } from "@embedpdf/plugin-zoom";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import type { Theme, ViewMode } from "../app/settings";
import { useNav } from "../app/useNav";
import { useWorkbench } from "../app/workbench";
import { ZOOM_PRESETS, parsePercent, percentToScale, scaleToPercent } from "../app/zoom";
import {
  DEFAULT_QUICK_TOOLBAR,
  actionEnabled,
  cleanQuickToolbar,
  resolveAction,
  tool,
  type ToolAction,
  type ToolContext,
  type ToolDef,
} from "../tools/registry";
import { useDocToolContext, useNoDocToolContext } from "../tools/useToolContext";
import { Icon, type IconName } from "./Icon";

function ToolButton({
  icon,
  label,
  onClick,
  pressed,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
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
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
    >
      <Icon name={icon} />
    </button>
  );
}

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

/**
 * Top bar (backlog B4, docs/reference/acrobat-workspace.png): file actions, then the quick
 * toolbar (page navigation, zoom, pinned tools), then view settings and the Tools pane
 * toggle. One row, like the reference.
 */
export function Toolbar({ documentId }: { documentId: string | null }) {
  const wb = useWorkbench();
  const { settings, updateSettings } = wb;
  return (
    <div className="toolbar" role="toolbar" aria-label="Main toolbar">
      <ToolButton icon="open" label="Open (Ctrl+O)" onClick={() => void wb.pickAndOpen()} />
      <ToolButton
        icon="save"
        label="Save (Ctrl+S)"
        disabled={!documentId || !wb.editState(documentId).dirty || wb.busy !== null}
        onClick={() => documentId && void wb.save(documentId)}
      />
      <ToolButton
        icon="print"
        label="Print (Ctrl+P)"
        disabled={!documentId}
        onClick={() =>
          documentId &&
          document.dispatchEvent(new CustomEvent("pdfwb:command", { detail: "print" }))
        }
      />
      <ToolButton
        icon="search"
        label="Find (Ctrl+F)"
        pressed={wb.searchOpen}
        disabled={!documentId}
        onClick={() => wb.setSearchOpen(!wb.searchOpen)}
      />
      {documentId ? <DocTools documentId={documentId} /> : <NoDocQuickTools />}
      <span className="grow" />
      {documentId && <ViewSettings />}
      <ToolButton
        icon="info"
        label="Document properties (Ctrl+D)"
        disabled={!documentId}
        onClick={() => documentId && wb.setDialog({ kind: "properties", documentId })}
      />
      <ToolButton
        icon="keyboard"
        label="Keyboard shortcuts (F1)"
        onClick={() => wb.setDialog({ kind: "shortcuts" })}
      />
      <button
        type="button"
        className="tool theme-toggle"
        aria-label={`Theme: ${settings.theme}`}
        title={`Theme: ${settings.theme} (click to change)`}
        onClick={() => updateSettings({ theme: NEXT_THEME[settings.theme] })}
      >
        <Icon name="theme" />
        <span className="theme-label">{settings.theme}</span>
      </button>
      <ToolButton
        icon="customize"
        label="Customize quick toolbar…"
        onClick={() => wb.setDialog({ kind: "customize" })}
      />
      <ToolButton
        icon="tools"
        label="Tools pane"
        pressed={settings.toolsPaneOpen}
        onClick={() => updateSettings({ toolsPaneOpen: !settings.toolsPaneOpen })}
      />
    </div>
  );
}

function ViewSettings() {
  const { settings, updateSettings } = useWorkbench();
  return (
    <>
      <label className="view-mode">
        <span className="visually-hidden">Page display</span>
        <select
          aria-label="Page display"
          value={settings.viewMode}
          onChange={(e) => updateSettings({ viewMode: e.target.value as ViewMode })}
        >
          <option value="single">Single page</option>
          <option value="continuous">Single page continuous</option>
          <option value="twoUp">Two-up continuous</option>
        </select>
      </label>
      {settings.viewMode === "twoUp" && (
        <label className="check" title="Show cover page in two-up view">
          <input
            type="checkbox"
            checked={settings.coverPage}
            onChange={(e) => updateSettings({ coverPage: e.target.checked })}
          />
          Cover page
        </label>
      )}
    </>
  );
}

function NoDocQuickTools() {
  const ctx = useNoDocToolContext();
  return (
    <>
      <span className="sep" />
      <QuickTools ctx={ctx} />
    </>
  );
}

function DocTools({ documentId }: { documentId: string }) {
  const { settings, updateSettings } = useWorkbench();
  const wb = useWorkbench();
  const nav = useNav(documentId);
  const { state: zoom, provides: zoomer } = useZoom(documentId);
  const ctx = useDocToolContext(documentId);
  const st = wb.editState(documentId);
  const busy = wb.busy !== null;

  // Remember the last zoom (a fit mode or a number) for the next document / session.
  useEffect(() => {
    const l = zoom.zoomLevel;
    const value =
      l === ZoomMode.FitPage
        ? "fit-page"
        : l === ZoomMode.FitWidth
          ? "fit-width"
          : typeof l === "number"
            ? l
            : null;
    if (value !== null && value !== settings.zoom) updateSettings({ zoom: value });
  }, [zoom.zoomLevel, settings.zoom, updateSettings]);

  return (
    <>
      <ToolButton
        icon="undo"
        label={st.undoLabel ? `Undo ${st.undoLabel} (Ctrl+Z)` : "Undo (Ctrl+Z)"}
        disabled={!st.undoLabel || busy}
        onClick={() => wb.undo(documentId)}
      />
      <ToolButton
        icon="redo"
        label={st.redoLabel ? `Redo ${st.redoLabel} (Ctrl+Y)` : "Redo (Ctrl+Y)"}
        disabled={!st.redoLabel || busy}
        onClick={() => wb.redo(documentId)}
      />
      <span className="sep" />
      <ToolButton
        icon="first"
        label="First page (Home)"
        onClick={nav.first}
        disabled={nav.page === 0}
      />
      <ToolButton
        icon="prev"
        label="Previous page (Left arrow)"
        onClick={nav.prev}
        disabled={nav.page === 0}
      />
      <PageBox page={nav.page} count={nav.pageCount} onGo={nav.goTo} />
      <ToolButton
        icon="next"
        label="Next page (Right arrow)"
        onClick={nav.next}
        disabled={nav.page >= nav.pageCount - 1}
      />
      <ToolButton
        icon="last"
        label="Last page (End)"
        onClick={nav.last}
        disabled={nav.page >= nav.pageCount - 1}
      />
      <span className="sep" />
      <ToolButton icon="zoomOut" label="Zoom out (Ctrl+-)" onClick={() => zoomer?.zoomOut()} />
      <ZoomBox scale={zoom.currentZoomLevel} onZoom={(s) => zoomer?.requestZoom(s)} />
      <ToolButton icon="zoomIn" label="Zoom in (Ctrl+=)" onClick={() => zoomer?.zoomIn()} />
      <span className="sep" />
      <QuickTools ctx={ctx} />
    </>
  );
}

/** The pinned tools: the user's list, else the firm default, else the built-in one. */
export function quickToolbarRefs(settings: {
  quickToolbar: string[] | null;
  firmLayoutCache: string[] | null;
}): string[] {
  return (
    cleanQuickToolbar(settings.quickToolbar) ??
    cleanQuickToolbar(settings.firmLayoutCache) ??
    DEFAULT_QUICK_TOOLBAR
  );
}

function QuickTools({ ctx }: { ctx: ToolContext }) {
  const { settings } = useWorkbench();
  return (
    <span className="quick-tools" role="group" aria-label="Quick tools">
      {quickToolbarRefs(settings).map((ref) => {
        const hit = resolveAction(ref);
        if (!hit) return null;
        return <QuickAction key={ref} tool={hit.tool} action={hit.action} ctx={ctx} />;
      })}
    </span>
  );
}

/** Quick-toolbar button: names what it acts on ("Rotate left: page 2"). */
function QuickAction({
  tool,
  action,
  ctx,
}: {
  tool: ToolDef;
  action: ToolAction;
  ctx: ToolContext;
}) {
  const target =
    tool.id === "view" || ctx.documentId === null
      ? ""
      : ctx.pages.length === 1
        ? `: page ${(ctx.pages[0] ?? 0) + 1}`
        : `: ${ctx.pages.length} selected pages`;
  return (
    <ToolButton
      icon={action.icon}
      label={`${action.label}${target}`}
      disabled={!actionEnabled(tool, action, ctx)}
      onClick={() => action.run(ctx)}
      {...(action.pressed ? { pressed: action.pressed(ctx) } : {})}
    />
  );
}

/** The open tool's own toolbar, above the page (e.g. Organize Pages). */
export function ToolToolbar({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const ctx = useDocToolContext(documentId);
  const t = tool(wb.meta[documentId]?.activeTool ?? "");
  if (!t || t.open !== "toolbar") return null;
  return (
    <div className="tool-toolbar" role="toolbar" aria-label={t.name} data-testid="tool-toolbar">
      <span className="tool-title">
        <span className="tool-icon" style={{ color: t.color }}>
          <Icon name={t.icon} />
        </span>
        {t.name}
      </span>
      <span className="sep" />
      {t.toolbar.map((a) => (
        <button
          key={a.id}
          type="button"
          className="tool labeled"
          aria-label={a.label}
          title={a.label}
          disabled={!actionEnabled(t, a, ctx)}
          onClick={() => a.run(ctx)}
        >
          <Icon name={a.icon} />
          <span aria-hidden="true">{a.caption ?? a.label}</span>
        </button>
      ))}
      <span className="grow" />
      <button type="button" onClick={() => wb.setActiveTool(documentId, null, ctx.pages[0])}>
        Close {t.name}
      </button>
    </div>
  );
}

function PageBox({
  page,
  count,
  onGo,
}: {
  page: number;
  count: number;
  onGo: (i: number) => void;
}) {
  const [text, setText] = useState(String(page + 1));
  const [editing, setEditing] = useState(false);
  const shown = editing ? text : String(page + 1);
  return (
    <span className="page-box">
      <input
        id="page-input"
        aria-label="Page number"
        inputMode="numeric"
        value={shown}
        onFocus={(e) => {
          setEditing(true);
          setText(String(page + 1));
          e.currentTarget.select();
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const n = Number.parseInt(text, 10);
            if (Number.isFinite(n)) onGo(n - 1);
            e.currentTarget.blur();
          } else if (e.key === "Escape") e.currentTarget.blur();
        }}
      />
      <span className="page-count" data-testid="page-count">
        / {count}
      </span>
    </span>
  );
}

function ZoomBox({ scale, onZoom }: { scale: number; onZoom: (scale: number) => void }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const shown = editing ? text : `${scaleToPercent(scale)}%`;
  return (
    <>
      <input
        id="zoom-input"
        className="zoom-box"
        aria-label="Zoom percentage"
        list="zoom-presets"
        value={shown}
        onFocus={(e) => {
          setEditing(true);
          setText(`${scaleToPercent(scale)}%`);
          e.currentTarget.select();
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const p = parsePercent(text);
            if (p !== null) onZoom(percentToScale(p));
            e.currentTarget.blur();
          } else if (e.key === "Escape") e.currentTarget.blur();
        }}
      />
      <datalist id="zoom-presets">
        {ZOOM_PRESETS.map((p) => (
          <option key={p} value={`${p}%`} />
        ))}
      </datalist>
    </>
  );
}
