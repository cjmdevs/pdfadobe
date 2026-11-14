// Preferences (B8, Edit > Preferences, Ctrl+K): categories on the left like Acrobat's,
// the chosen category's settings on the right. Every change is saved at once (per user);
// there is nothing to apply. Labels come from src/app/prefsIndex.ts, which the command
// search also reads, so a search result can open the right category at the right row.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import { DEFAULT_SETTINGS, type Theme, type ViewMode, type ZoomSetting } from "../../app/settings";
import { libraryPaths } from "../../app/firstRun";
import { PREF_CATEGORIES, prefDef, type PrefCategory } from "../../app/prefsIndex";
import { clearRecent, dropThumbs } from "../../app/recent";
import { UNIT_LABEL, type Units } from "../../app/units";
import { useWorkbench } from "../../app/workbench";
import { toolDefaults } from "../../markup/config";
import { platform, type UpdateState } from "../../platform";
import { Modal } from "../kit/Dialog";
import { describeUpdate } from "../UpdateDialog";
import { CALC_DECIMALS, type CalcDecimals, type CalcMode } from "../../flyer/calc";

/** One setting: label on the left (from the shared index), control on the right. */
function Row({ id, children, hint }: { id: string; children: ReactNode; hint?: ReactNode }) {
  const label = prefDef(id)?.label ?? id;
  return (
    <div className="pref-row" id={`pref-${id}`} data-pref={id}>
      <div className="pref-label">{label}</div>
      <div className="pref-control">{children}</div>
      {hint && <p className="hint pref-hint">{hint}</p>}
    </div>
  );
}

function Check({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      aria-label={prefDef(id)?.label ?? id}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/** A text box that saves on Enter or when it loses focus. */
function TextPref({
  id,
  value,
  placeholder,
  onCommit,
}: {
  id: string;
  value: string | null;
  placeholder?: string;
  onCommit: (v: string | null) => void;
}) {
  const [text, setText] = useState(value ?? "");
  // Changed elsewhere (another window, a reset): show the new value.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value ?? "");
  }
  const commit = () => {
    const v = text.trim() || null;
    if (v !== value) onCommit(v);
  };
  return (
    <input
      aria-label={prefDef(id)?.label ?? id}
      value={text}
      placeholder={placeholder}
      maxLength={1000}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

export function PreferencesDialog({
  onClose,
  category,
  focus,
}: {
  onClose: () => void;
  category?: PrefCategory | undefined;
  focus?: string | undefined;
}) {
  const [cat, setCat] = useState<PrefCategory>(category ?? "general");
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    const row = body.current?.querySelector<HTMLElement>(`[data-pref="${focus}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    row.classList.add("found");
    row.querySelector<HTMLElement>("input, select, button")?.focus();
  }, [focus, cat]);
  return (
    <Modal title="Preferences" onClose={onClose} wide>
      <div className="prefs">
        <div
          className="prefs-nav"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Categories"
        >
          {PREF_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={cat === c.id}
              className={cat === c.id ? "active" : undefined}
              onClick={() => setCat(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div
          ref={body}
          className="prefs-body"
          role="tabpanel"
          aria-label={PREF_CATEGORIES.find((c) => c.id === cat)?.label}
          data-testid="prefs-body"
        >
          {cat === "general" && <General />}
          {cat === "pageDisplay" && <PageDisplay />}
          {cat === "commenting" && <Commenting />}
          {cat === "editPdf" && <EditPdf />}
          {cat === "fonts" && <Fonts />}
          {cat === "pdflyer" && <Pdflyer />}
          {cat === "security" && <Security />}
          {cat === "updates" && <Updates />}
        </div>
      </div>
    </Modal>
  );
}

function General() {
  const wb = useWorkbench();
  const s = wb.settings;
  return (
    <>
      <Row id="theme">
        <select
          aria-label="Theme"
          value={s.theme}
          onChange={(e) => wb.updateSettings({ theme: e.target.value as Theme })}
        >
          <option value="system">Same as Windows</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Row>
      <Row id="restoreSession" hint="Otherwise PDF Workbench starts on the Home screen.">
        <Check
          id="restoreSession"
          checked={s.restoreSession}
          onChange={(on) => wb.updateSettings({ restoreSession: on })}
        />
      </Row>
      <Row
        id="recentThumbnails"
        hint="Pictures of page 1, kept only on this PC; turning them off deletes them."
      >
        <Check
          id="recentThumbnails"
          checked={s.recentThumbnails}
          onChange={(on) => {
            if (!on) {
              wb.changeRecent(dropThumbs);
              void platform.thumbs.keep([]).catch(() => undefined);
            }
            wb.updateSettings({ recentThumbnails: on });
          }}
        />
      </Row>
      <Row id="toolsPaneOpen">
        <Check
          id="toolsPaneOpen"
          checked={s.toolsPaneOpen}
          onChange={(on) => wb.updateSettings({ toolsPaneOpen: on })}
        />
      </Row>
      <Row
        id="firmLibraryPath"
        hint="The firm's shared folder with tickmarks.json, layout.json and a fonts folder."
      >
        <TextPref
          id="firmLibraryPath"
          value={s.firmLibraryPath}
          placeholder="\\server\share\PDF Workbench"
          onCommit={(v) =>
            wb.updateSettings(
              v ? { firmLibraryPath: v, ...libraryPaths(v) } : { firmLibraryPath: null },
            )
          }
        />
      </Row>
      <Row id="defaultApp">
        <button type="button" onClick={() => wb.setDialog({ kind: "firstRun", startAt: 3 })}>
          Choose default PDF program…
        </button>
      </Row>
    </>
  );
}

function PageDisplay() {
  const wb = useWorkbench();
  const s = wb.settings;
  const zoomValue = typeof s.zoom === "number" ? "number" : s.zoom;
  return (
    <>
      <Row id="viewMode">
        <select
          aria-label="Page display"
          value={s.viewMode}
          onChange={(e) => wb.updateSettings({ viewMode: e.target.value as ViewMode })}
        >
          <option value="single">Single page</option>
          <option value="continuous">Single page continuous</option>
          <option value="twoUp">Two-up continuous</option>
        </select>
      </Row>
      <Row id="zoom" hint="PDF Workbench also remembers the last zoom you picked.">
        <select
          aria-label="Zoom for new documents"
          value={zoomValue}
          onChange={(e) => {
            const v = e.target.value;
            const zoom: ZoomSetting = v === "fit-page" || v === "fit-width" ? v : 1;
            wb.updateSettings({ zoom });
          }}
        >
          <option value="fit-width">Fit width</option>
          <option value="fit-page">Fit page</option>
          <option value="number">
            {typeof s.zoom === "number" ? `${Math.round(s.zoom * 100)} %` : "100 %"}
          </option>
        </select>
      </Row>
      <Row id="coverPage">
        <Check
          id="coverPage"
          checked={s.coverPage}
          onChange={(on) => wb.updateSettings({ coverPage: on })}
        />
      </Row>
      <Row id="units" hint="Used by the position readout while dragging and by Page properties.">
        <select
          aria-label="Units"
          value={s.units}
          onChange={(e) => wb.updateSettings({ units: e.target.value as Units })}
        >
          <option value="in">Inches ({UNIT_LABEL.in})</option>
          <option value="mm">Millimetres ({UNIT_LABEL.mm})</option>
          <option value="pt">Points ({UNIT_LABEL.pt})</option>
        </select>
      </Row>
      <Row id="formHighlight">
        <Check
          id="formHighlight"
          checked={s.formHighlight}
          onChange={(on) => wb.updateSettings({ formHighlight: on })}
        />
      </Row>
      <Row id="bookmarkDragMovesPages">
        <Check
          id="bookmarkDragMovesPages"
          checked={s.bookmarkDragMovesPages}
          onChange={(on) => wb.updateSettings({ bookmarkDragMovesPages: on })}
        />
      </Row>
    </>
  );
}

function Commenting() {
  const wb = useWorkbench();
  const s = wb.settings;
  const { provides: annots } = useAnnotationCapability();
  const resetStyles = () => {
    const cleared = { ...s, markupDefaults: {} };
    for (const id of Object.keys(s.markupDefaults))
      annots?.setToolDefaults(id, toolDefaults(cleared, id));
    wb.updateSettings({ markupDefaults: {} });
    wb.toast("Markup tools are back to the firm's default styles.");
  };
  return (
    <>
      <Row
        id="authorName"
        hint={
          <>
            Leave blank to use your Windows name{wb.osUserName ? ` (${wb.osUserName})` : ""}. New
            comments are signed <strong>{wb.author}</strong>; existing ones keep their author.
          </>
        }
      >
        <TextPref
          id="authorName"
          value={s.authorName}
          placeholder={wb.osUserName ?? "Reviewer"}
          onCommit={(authorName) => wb.updateSettings({ authorName })}
        />
      </Row>
      <Row id="userInitials" hint="Leave blank to use the first letters of the author name.">
        <TextPref
          id="userInitials"
          value={s.userInitials}
          onCommit={(userInitials) => wb.updateSettings({ userInitials })}
        />
      </Row>
      <Row id="markupColors">
        <span className="pref-swatches" aria-label="Colour swatches">
          {s.markupColors.map((c) => (
            <span key={c} className="pref-swatch" style={{ background: c }} title={c} />
          ))}
        </span>
        <button
          type="button"
          disabled={s.markupColors.join() === DEFAULT_SETTINGS.markupColors.join()}
          onClick={() => wb.updateSettings({ markupColors: DEFAULT_SETTINGS.markupColors })}
        >
          Reset swatches
        </button>
      </Row>
      <Row id="markupDefaults">
        <button
          type="button"
          disabled={Object.keys(s.markupDefaults).length === 0}
          onClick={resetStyles}
        >
          Reset to firm defaults
        </button>
      </Row>
    </>
  );
}

function EditPdf() {
  const wb = useWorkbench();
  const s = wb.settings;
  return (
    <>
      <Row
        id="snapToGuides"
        hint="Comments, redaction boxes, text boxes, images, stamps and form fields. Hold Alt while dragging to place freely."
      >
        <Check
          id="snapToGuides"
          checked={s.snapToGuides}
          onChange={(on) => wb.updateSettings({ snapToGuides: on })}
        />
      </Row>
      <Row
        id="snapDistance"
        hint="How close (in screen pixels) an edge has to come before it snaps."
      >
        <input
          type="number"
          aria-label="Snap distance"
          min={2}
          max={20}
          value={s.snapDistance}
          disabled={!s.snapToGuides}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (n >= 2 && n <= 20) wb.updateSettings({ snapDistance: n });
          }}
        />
      </Row>
      <Row id="showBoxReadout">
        <Check
          id="showBoxReadout"
          checked={s.showBoxReadout}
          onChange={(on) => wb.updateSettings({ showBoxReadout: on })}
        />
      </Row>
    </>
  );
}

function Fonts() {
  const wb = useWorkbench();
  return (
    <>
      <Row
        id="firmFontsPath"
        hint="Fonts here are listed under Firm in Edit PDF. A copy is kept on this PC, so they still work when the share is offline."
      >
        <TextPref
          id="firmFontsPath"
          value={wb.settings.firmFontsPath}
          placeholder="\\server\share\Fonts"
          onCommit={(firmFontsPath) => wb.updateSettings({ firmFontsPath })}
        />
      </Row>
      <Row id="fontSources">
        <ul className="pref-list">
          <li>Windows fonts (C:\Windows\Fonts)</li>
          <li>Fonts you installed for yourself</li>
          <li>The firm font folder above</li>
        </ul>
      </Row>
    </>
  );
}

function Pdflyer() {
  const wb = useWorkbench();
  const s = wb.settings;
  const calc = (patch: Partial<typeof s.calc>) =>
    wb.updateSettings({ calc: { ...s.calc, ...patch } });
  return (
    <>
      <Row id="firmTickmarksPath" hint="Firm tickmarks and stamps (workpaper settings file).">
        <TextPref
          id="firmTickmarksPath"
          value={s.firmTickmarksPath}
          placeholder="\\server\share\tickmarks.json"
          onCommit={(firmTickmarksPath) => wb.updateSettings({ firmTickmarksPath })}
        />
      </Row>
      <Row id="tickmarkLibrary">
        <button type="button" onClick={() => wb.setDialog({ kind: "tickmarks" })}>
          Open tickmark library…
        </button>
      </Row>
      <Row id="calcMode">
        <select
          aria-label="Calculator keypad"
          value={s.calc.mode}
          onChange={(e) => calc({ mode: e.target.value as CalcMode })}
        >
          <option value="tenKey">10-key (adding machine)</option>
          <option value="standard">Standard</option>
        </select>
      </Row>
      <Row id="calcDecimals">
        <select
          aria-label="Calculator decimals"
          value={String(s.calc.decimals)}
          onChange={(e) =>
            calc({
              decimals: (e.target.value === "F" ? "F" : Number(e.target.value)) as CalcDecimals,
            })
          }
        >
          {CALC_DECIMALS.map((d) => (
            <option key={d} value={String(d)}>
              {d === "F" ? "Floating" : d}
            </option>
          ))}
        </select>
      </Row>
      <Row id="calcAddMode">
        <Check id="calcAddMode" checked={s.calc.addMode} onChange={(on) => calc({ addMode: on })} />
      </Row>
      <Row id="calcTapeColor">
        <input
          type="color"
          aria-label="Calculator tape colour"
          value={s.calc.tapeColor}
          onChange={(e) => calc({ tapeColor: e.target.value.toUpperCase() })}
        />
      </Row>
      <Row id="showStampNames">
        <Check
          id="showStampNames"
          checked={s.showStampNames}
          onChange={(on) => wb.updateSettings({ showStampNames: on })}
        />
      </Row>
      <Row id="recentTickmarks">
        <button
          type="button"
          disabled={s.recentTickmarks.length === 0}
          onClick={() => wb.updateSettings({ recentTickmarks: [] })}
        >
          Clear
        </button>
      </Row>
    </>
  );
}

function Security() {
  const wb = useWorkbench();
  return (
    <>
      <Row id="signWithDate">
        <Check
          id="signWithDate"
          checked={wb.settings.signWithDate}
          onChange={(on) => wb.updateSettings({ signWithDate: on })}
        />
      </Row>
      <Row id="claudeAccess">
        <p className="muted">
          Set by the firm's Windows policy (see the admin guide). It cannot be changed here.
        </p>
      </Row>
      <Row id="clearRecent" hint="Removes every file from the Home screen list, pinned ones too.">
        <button
          type="button"
          disabled={wb.settings.recent.length === 0}
          onClick={async () => {
            const ok = await wb.confirm({
              title: "Clear recent files",
              message:
                "Remove every file from Recent Files, pinned ones too? The files stay where they are.",
              ok: "Clear",
              danger: true,
            });
            if (!ok) return;
            wb.changeRecent(clearRecent);
            void platform.thumbs.keep([]).catch(() => undefined);
          }}
        >
          Clear…
        </button>
      </Row>
    </>
  );
}

export function useUpdateCheck() {
  const wb = useWorkbench();
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    const s = await platform.app.checkUpdate();
    setChecking(false);
    setUpdate(s);
    // Only a check that reached the folder counts: an offline laptop tries again next start.
    if (s.kind === "upToDate" || s.kind === "available")
      wb.updateSettings({ lastUpdateCheck: Date.now() });
    if (s.kind === "available") wb.setDialog({ kind: "update", info: s.info });
  };
  return { update, checking, check };
}

function Updates() {
  const wb = useWorkbench();
  const { update, checking, check } = useUpdateCheck();
  const last = wb.settings.lastUpdateCheck;
  return (
    <>
      <Row
        id="checkUpdates"
        hint="Updates come from the firm's update folder; PDF Workbench checks once a day at start."
      >
        <button type="button" disabled={checking} onClick={() => void check()}>
          {checking ? "Checking…" : "Check for updates"}
        </button>
      </Row>
      {update && (
        <p className="hint" role="status" data-testid="update-status">
          {describeUpdate(update)}
        </p>
      )}
      <Row id="lastUpdateCheck">
        <span>{last ? new Date(last).toLocaleString() : "Never"}</span>
      </Row>
    </>
  );
}
