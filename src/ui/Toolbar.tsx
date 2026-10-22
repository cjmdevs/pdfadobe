import { useEffect, useState } from "react";
import { ZoomMode } from "@embedpdf/plugin-zoom";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import type { Theme, ViewMode } from "../app/settings";
import { usePageActions } from "../app/pageActions";
import { useNav } from "../app/useNav";
import { useWorkbench } from "../app/workbench";
import {
  ZOOM_PRESETS,
  parsePercent,
  percentToScale,
  scaleToPercent,
  ACTUAL_SIZE_SCALE,
} from "../app/zoom";
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
        icon="combine"
        label="Combine Files…"
        onClick={() => wb.setDialog({ kind: "combine" })}
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
      <span className="sep" />
      <ToolButton
        icon="sidebar"
        label="Navigation pane (F4)"
        pressed={settings.sidebarOpen}
        onClick={() => updateSettings({ sidebarOpen: !settings.sidebarOpen })}
      />
      {documentId ? <DocTools documentId={documentId} /> : <span className="grow" />}
      <ToolButton
        icon="search"
        label="Find (Ctrl+F)"
        pressed={wb.searchOpen}
        disabled={!documentId}
        onClick={() => wb.setSearchOpen(!wb.searchOpen)}
      />
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
    </div>
  );
}

function EditTools({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const nav = useNav(documentId);
  const st = wb.editState(documentId);
  const organize = wb.meta[documentId]?.organize ?? false;
  const busy = wb.busy !== null;
  return (
    <>
      <span className="sep" />
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
      <ToolButton
        icon="organize"
        label="Organize pages"
        pressed={organize}
        onClick={() => wb.setOrganize(documentId, !organize, nav.page)}
      />
    </>
  );
}

function DocTools({ documentId }: { documentId: string }) {
  const { settings, updateSettings, meta } = useWorkbench();
  const nav = useNav(documentId);
  const { state: zoom, provides: zoomer } = useZoom(documentId);
  const actions = usePageActions(documentId);
  const busy = useWorkbench().busy !== null;

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

  if (meta[documentId]?.organize) return <EditTools documentId={documentId} />;
  return (
    <>
      <EditTools documentId={documentId} />
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
      <ToolButton
        icon="fitPage"
        label="Fit page (Ctrl+0)"
        pressed={zoom.zoomLevel === ZoomMode.FitPage}
        onClick={() => zoomer?.requestZoom(ZoomMode.FitPage)}
      />
      <ToolButton
        icon="fitWidth"
        label="Fit width (Ctrl+2)"
        pressed={zoom.zoomLevel === ZoomMode.FitWidth}
        onClick={() => zoomer?.requestZoom(ZoomMode.FitWidth)}
      />
      <ToolButton
        icon="actual"
        label="Actual size (Ctrl+1)"
        onClick={() => zoomer?.requestZoom(ACTUAL_SIZE_SCALE)}
      />
      <span className="sep" />
      {/* Rotates the page and saves with the file (undoable). Turning only the display
          is Acrobat's View > Rotate View: Ctrl+Shift+Plus / Minus. */}
      <ToolButton
        icon="rotateCcw"
        label={`Rotate page ${nav.page + 1} left`}
        disabled={busy}
        onClick={() => void actions.rotate([nav.page], 3)}
      />
      <ToolButton
        icon="rotateCw"
        label={`Rotate page ${nav.page + 1} right`}
        disabled={busy}
        onClick={() => void actions.rotate([nav.page], 1)}
      />
      <span className="sep" />
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
      <span className="grow" />
    </>
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
