// "An update is ready" (Phase 10a). The installer comes from the firm's update folder,
// is checked against the firm's update key and its code signature, then runs in passive
// mode and starts PDF Workbench again. Unsaved work must be saved first.
import { useState } from "react";
import { useWorkbench } from "../app/workbench";
import { platform, type UpdateInfo, type UpdateState } from "../platform";
import { Modal, ModalActions } from "./kit/Dialog";

export function UpdateDialog({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const wb = useWorkbench();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const install = async () => {
    setProblem(null);
    const dirty = await platform.docs.dirty().catch(() => []);
    if (dirty.length) {
      setProblem(
        `Save or close these first: ${dirty.map((d) => d.name).join(", ")}. The update closes PDF Workbench.`,
      );
      return;
    }
    setBusy(true);
    try {
      await platform.app.installUpdate(info.version);
      // The app closes; the installer starts it again.
    } catch (e) {
      setBusy(false);
      setProblem(`The update could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Modal
      title={info.rollback ? "The firm is going back a version" : "Update available"}
      onClose={onClose}
      closeLabel="Later"
    >
      <div data-testid="update-dialog">
        <p>
          {info.rollback
            ? `Your firm asks everyone to go back to PDF Workbench ${info.version} (you have ${info.current}).`
            : `PDF Workbench ${info.version} is ready (you have ${info.current}).`}{" "}
          It installs in about a minute and PDF Workbench opens again by itself.
        </p>
        {info.notes && <pre className="update-notes">{info.notes}</pre>}
        {problem && (
          <p className="error" role="alert" data-testid="update-problem">
            {problem}
          </p>
        )}
        {Object.keys(wb.meta).length > 0 && !problem && (
          <p className="hint">Files you have open are closed; save your work first.</p>
        )}
        <ModalActions>
          <button type="button" className="primary" disabled={busy} onClick={() => void install()}>
            {busy ? "Starting the installer…" : "Install now"}
          </button>
        </ModalActions>
      </div>
    </Modal>
  );
}

/** One line about an update check, for Settings. */
export function describeUpdate(s: UpdateState): string {
  switch (s.kind) {
    case "off":
      return {
        policy: "Updates are turned off by the firm.",
        noSource: "No update folder is set for this PC (see the admin guide).",
        noKey: "This build has no update key.",
        dev: "Updates are off in development builds.",
      }[s.reason];
    case "upToDate":
      return `PDF Workbench ${s.current} is up to date.`;
    case "available":
      return s.info.rollback
        ? `The firm asks to go back to version ${s.info.version}.`
        : `Version ${s.info.version} is available.`;
    case "unreachable":
      return "The firm's update folder can't be reached right now (off the network?).";
    case "bad":
      return `The update was refused: ${s.message}`;
  }
}
