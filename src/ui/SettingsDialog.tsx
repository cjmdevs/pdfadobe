// Settings (Phase 3): the markup author name and the saved markup styles.
import { useState } from "react";
import { useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import { useWorkbench } from "../app/workbench";
import { toolDefaults } from "../markup/config";

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
    </div>
  );
}
