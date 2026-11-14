// About PDF Workbench (B8, Help > About): version, updates, default PDF program, crash
// reports and licence notices. Was the About part of the old Settings dialog.
import { useEffect, useState } from "react";
import { useWorkbench } from "../../app/workbench";
import { platform } from "../../platform";
import { Modal } from "../kit/Dialog";
import { describeUpdate } from "../UpdateDialog";
import { useUpdateCheck } from "./PreferencesDialog";

export function AboutDialog({ onClose, check }: { onClose: () => void; check?: boolean }) {
  const wb = useWorkbench();
  const [version, setVersion] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const updates = useUpdateCheck();
  useEffect(() => {
    void platform.app.version().then(setVersion);
    void platform.app.isDefaultPdfApp().then(setIsDefault);
    if (check) void updates.check();
    // Once, when opened from Help > Check for updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Modal title="About PDF Workbench" onClose={onClose}>
      <section className="settings-about" aria-label="About PDF Workbench" data-testid="about">
        <p>Version {version ?? "…"}</p>
        <div className="settings-row">
          <span>Updates come from the firm's update folder</span>
          <button type="button" disabled={updates.checking} onClick={() => void updates.check()}>
            {updates.checking ? "Checking…" : "Check for updates"}
          </button>
        </div>
        {updates.update && (
          <p className="hint" role="status" data-testid="update-status">
            {describeUpdate(updates.update)}
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
    </Modal>
  );
}
