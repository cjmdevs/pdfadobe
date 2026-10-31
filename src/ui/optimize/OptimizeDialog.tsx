// Reduce File Size (Phase 7): pick a preset, see the size before and after, and save
// the result as a new file "<name>_Optimized.pdf" beside the original (which is never
// changed), then open it.
import { useState } from "react";
import { useWorkbench } from "../../app/workbench";
import { pageOp } from "../../app/pages";
import {
  OPTIMIZE_PRESETS,
  type OptimizePresetId,
  type OptimizeReport,
} from "../../engine/optimize";
import { formatFileSize } from "../../engine/properties";
import { dirName, platform, safeFileName } from "../../platform";

const stem = (name: string) => name.replace(/\.pdf$/i, "");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function OptimizeDialog({ documentId, onClose }: { documentId: string; onClose(): void }) {
  const wb = useWorkbench();
  const [preset, setPreset] = useState<OptimizePresetId>("standard");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<OptimizeReport | null>(null);

  const run = async () => {
    setWorking(true);
    setResult(null);
    try {
      const bytes = await wb.docBytes(documentId);
      if (!bytes) {
        wb.toast("This document cannot be optimized (it is password-protected).", "error");
        return;
      }
      setResult(await pageOp("optimize", bytes, preset));
    } catch (e) {
      wb.toast(`Reduce file size failed: ${message(e)}`, "error");
    } finally {
      setWorking(false);
    }
  };

  const save = async () => {
    const m = wb.meta[documentId];
    if (!m || !result) return;
    const name = safeFileName(`${stem(m.name)}_Optimized.pdf`);
    try {
      let path: string | null;
      if (m.source.kind === "path")
        path = await platform.writeNewFile(dirName(m.source.path), name, result.bytes);
      else {
        path = await platform.pickSavePath(name);
        if (path) await platform.saveAs(path, null, result.bytes);
      }
      if (!path) return;
      wb.toast(`Saved the smaller copy. The original is unchanged.`);
      onClose();
      await wb.openPaths([path]);
    } catch (e) {
      wb.toast(`Could not save: ${message(e)}`, "error");
    }
  };

  const smaller = result !== null && result.after < result.before;
  const percent = result ? Math.round((1 - result.after / result.before) * 100) : 0;
  return (
    <div className="optimize" data-testid="optimize">
      <fieldset disabled={working}>
        <legend>Preset</legend>
        {(Object.keys(OPTIMIZE_PRESETS) as OptimizePresetId[]).map((id) => (
          <label key={id}>
            <input
              type="radio"
              name="optimize-preset"
              checked={preset === id}
              onChange={() => {
                setPreset(id);
                setResult(null);
              }}
            />
            <span>
              <strong>{OPTIMIZE_PRESETS[id].label}</strong> — {OPTIMIZE_PRESETS[id].description}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="hint">
        Also subsets fully embedded fonts, removes unused objects and, when it does not add size,
        turns on fast web view. Black-and-white scans are left as they are.
      </p>
      <div className="row">
        <button type="button" className="primary" onClick={() => void run()} disabled={working}>
          {working ? "Reducing…" : "Reduce File Size"}
        </button>
      </div>
      {result && (
        <div role="status" data-testid="optimize-result">
          <p>
            Before: <strong>{formatFileSize(result.before)}</strong> · After:{" "}
            <strong>{formatFileSize(result.after)}</strong>
            {smaller ? ` (${percent}% smaller)` : ""}
          </p>
          <p className="hint">
            Images made smaller: {result.recompressed} ({result.downsampled} at a lower resolution)
            · Fonts subset: {result.fontsSubset} · Fast web view: {result.linearized ? "on" : "off"}
          </p>
          {smaller ? (
            <button type="button" onClick={() => void save()}>
              Save as {stem(wb.meta[documentId]?.name ?? "Document")}_Optimized.pdf
            </button>
          ) : (
            <p>This preset could not make the file smaller. Nothing to save.</p>
          )}
        </div>
      )}
    </div>
  );
}
