// Settings (Phase 3, B2): markup author and styles, Home screen start and thumbnails.
import { useEffect, useState } from "react";
import { useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import { useWorkbench } from "../app/workbench";
import { toolDefaults } from "../markup/config";
import { dropThumbs } from "../app/recent";
import { platform, type UpdateState } from "../platform";
import { describeUpdate } from "./UpdateDialog";

export function SettingsBody() {
  const wb = useWorkbench();
  const { provides: annots } = useAnnotationCapability();
  const [name, setName] = useState(wb.settings.authorName ?? "");
  const [firmFonts, setFirmFonts] = useState(wb.settings.firmFontsPath ?? "");
  const commitFirmFonts = () => {
    const firmFontsPath = firmFonts.trim() || null;
    if (firmFontsPath !== wb.settings.firmFontsPath) wb.updateSettings({ firmFontsPath });
  };
  const commit = () => {
    const authorName = name.trim() || null;
    if (authorName !== wb.settings.authorName) wb.updateSettings({ authorName });
  };
  const resetStyles = () => {
    const cleared = { ...wb.settings, markupDefaults: {} };
    for (const id of Object.keys(wb.settings.markupDefaults))
      annots?.setToolDefaults(id, toolDefaults(cleared, id));
    wb.updateSettings({ markupDefaults: {} });
    wb.toast("Markup tools are back to the firm's default styles.");
  };
  return (
    <div className="settings-form">
      <label className="settings-row">
        <span>Author name for comments</span>
        <input
          aria-label="Author name"
          value={name}
          placeholder={wb.osUserName ?? "Reviewer"}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
      </label>
      <p className="hint">
        {wb.osUserName
          ? `Leave blank to use your Windows name (${wb.osUserName}).`
          : "Leave blank to use your Windows name."}{" "}
        New comments are signed <strong>{name.trim() || wb.author}</strong>; existing comments keep
        their author.
      </p>
      <label className="settings-row">
        <span>Firm font folder (Edit PDF)</span>
        <input
          aria-label="Firm font folder"
          value={firmFonts}
          placeholder="\\server\share\Fonts"
          maxLength={1000}
          onChange={(e) => setFirmFonts(e.target.value)}
          onBlur={commitFirmFonts}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitFirmFonts();
          }}
        />
      </label>
      <p className="hint">
        Fonts in this folder are listed under Firm in Edit PDF. A copy is kept on this PC, so they
        still work when the share is offline.
      </p>
      <div className="checks">
        <label>
          <input
            type="checkbox"
            checked={wb.settings.restoreSession}
            onChange={(e) => wb.updateSettings({ restoreSession: e.target.checked })}
          />{" "}
          Reopen last session’s files at start
        </label>
        <label>
          <input
            type="checkbox"
            checked={wb.settings.recentThumbnails}
            onChange={(e) => {
              const on = e.target.checked;
              if (!on) {
                wb.changeRecent(dropThumbs);
                void platform.thumbs.keep([]).catch(() => undefined);
              }
              wb.updateSettings({ recentThumbnails: on });
            }}
          />{" "}
          Show page thumbnails in recent files
        </label>
      </div>
      <p className="hint">
        Otherwise PDF Workbench starts on the Home screen. Thumbnails are pictures of page 1, kept
        only on this PC; turning them off deletes them.
      </p>
      <div className="settings-row">
        <span>Markup styles saved with “Make default”</span>
        <button
          type="button"
          disabled={Object.keys(wb.settings.markupDefaults).length === 0}
          onClick={resetStyles}
        >
          Reset to firm defaults
        </button>
      </div>
      <AboutSection />
    </div>
  );
}

/** Version, updates, default PDF program, crash reports, notices (Phase 10a). */
function AboutSection() {
  const wb = useWorkbench();
  const [version, setVersion] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    void platform.app.version().then(setVersion);
    void platform.app.isDefaultPdfApp().then(setIsDefault);
  }, []);
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
  return (
    <section className="settings-about" aria-label="About PDF Workbench" data-testid="about">
      <h3>About PDF Workbench</h3>
      <p>Version {version ?? "…"}</p>
      <div className="settings-row">
        <span>Updates come from the firm's update folder</span>
        <button type="button" disabled={checking} onClick={() => void check()}>
          {checking ? "Checking…" : "Check for updates"}
        </button>
      </div>
      {update && (
        <p className="hint" role="status" data-testid="update-status">
          {describeUpdate(update)}
        </p>
      )}
      <div className="settings-row">
        <span>
          {isDefault === true
            ? "PDF Workbench opens PDF files"
            : isDefault === false
              ? "PDF files open in another program"
              : "Default PDF program"}
        </span>
        <button type="button" onClick={() => wb.setDialog({ kind: "firstRun", startAt: 3 })}>
          Choose default PDF program…
        </button>
      </div>
      <div className="settings-row">
        <span>Crash reports (kept on this PC only)</span>
        <button type="button" onClick={() => void platform.app.openCrashFolder()}>
          Show folder
        </button>
      </div>
      <div className="settings-row">
        <span>Licenses of the software PDF Workbench includes</span>
        <button type="button" onClick={() => void platform.app.openNotices()}>
          Third-party notices
        </button>
      </div>
    </section>
  );
}
