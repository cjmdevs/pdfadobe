// Recognize Text in a Folder (Phase 7): pick a folder, read every PDF in it, and save
// each as <name>_OCR.pdf beside the original. Progress per file, Cancel stops after the
// page being read. Closing the dialog while it runs cancels it.
import { useEffect, useState } from "react";
import { useWorkbench } from "../../app/workbench";
import { platform } from "../../platform";
import { baseName } from "../../platform/types";
import { recognizeFiles, type BatchFile } from "./scanActions";
import { scan, useScan } from "./scanStore";

const STATUS: Record<BatchFile["status"], string> = {
  waiting: "Waiting",
  reading: "Reading…",
  done: "Done",
  skipped: "Left alone",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function BatchOcr() {
  const wb = useWorkbench();
  const { run } = useScan();
  const [folder, setFolder] = useState<string | null>(null);
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [started, setStarted] = useState(false);
  const running = run?.kind === "batch";

  // Closing the dialog stops the batch.
  useEffect(
    () => () => {
      const r = scan.get().run;
      if (r?.kind === "batch") r.cancel();
    },
    [],
  );

  const choose = async () => {
    const dir = await platform.pickFolder();
    if (!dir) return;
    try {
      const pdfs = (await platform.listFolder(dir)).filter((p) => /\.pdf$/i.test(p));
      setFolder(dir);
      setFiles(pdfs.map((path) => ({ path, status: "waiting" })));
      setStarted(false);
    } catch (e) {
      wb.toast(`Could not read the folder: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

  const start = () => {
    setStarted(true);
    void recognizeFiles(
      files.map((f) => f.path),
      setFiles,
    );
  };

  const finished = started && !running;
  return (
    <div className="batch-ocr" data-testid="batch-ocr">
      <div className="row">
        <button type="button" onClick={() => void choose()} disabled={running}>
          Choose Folder…
        </button>
        <span className="hint">{folder ?? "No folder chosen"}</span>
      </div>
      {folder && files.length === 0 && <p className="hint">This folder has no PDFs.</p>}
      {files.length > 0 && (
        <table className="batch-files">
          <tbody>
            {files.map((f) => (
              <tr key={f.path} data-status={f.status}>
                <td>{baseName(f.path)}</td>
                <td>{STATUS[f.status]}</td>
                <td className="hint">{f.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        {running ? (
          <>
            <progress max={files.length} value={run.done} />
            <button type="button" onClick={run.cancel}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={start}
            disabled={files.length === 0 || run !== null || finished}
          >
            Recognize Text in {files.length} {files.length === 1 ? "file" : "files"}
          </button>
        )}
      </div>
      {finished && (
        <p role="status">
          Finished: {files.filter((f) => f.status === "done").length} saved,{" "}
          {files.filter((f) => f.status === "skipped").length} left alone,{" "}
          {files.filter((f) => f.status === "failed").length} failed.
        </p>
      )}
    </div>
  );
}
