// Node runner for the engine's qpdf jobs (MCP server and tests). Same rules as the Tauri
// command (src-tauri/src/qpdf_job.rs): a private job folder, plain file names only,
// deleted afterwards. The MCP server puts job folders inside the task's _workspace
// folder (`workBase`), so no document copy is ever written anywhere else.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkJob, QpdfError, type Qpdf, type QpdfJob } from "../../../src/engine/pages/qpdf";

export function nodeQpdf(bin: string, workBase: () => string): Qpdf {
  return {
    run(job: QpdfJob) {
      checkJob(job);
      const dir = mkdtempSync(join(workBase(), "qpdf-"));
      for (const [name, bytes] of Object.entries(job.inputs)) writeFileSync(join(dir, name), bytes);
      return new Promise((resolve, reject) => {
        execFile(
          bin,
          job.args,
          { cwd: dir, maxBuffer: 256 * 1024 * 1024, encoding: "utf8", windowsHide: true },
          (err, stdout, stderr) => {
            const code = err ? (typeof err.code === "number" ? err.code : -1) : 0;
            try {
              if (code !== 0 && code !== 3) {
                reject(new QpdfError(firstLine(stderr) || `qpdf failed (exit ${code})`));
                return;
              }
              const files: Record<string, Uint8Array> = {};
              for (const o of job.outputs) {
                try {
                  files[o] = new Uint8Array(readFileSync(join(dir, o)));
                } catch {
                  // missing output: runToFile reports it
                }
              }
              resolve({ files, stdout, warnings: code === 3 });
            } finally {
              rmSync(dir, { recursive: true, force: true });
            }
          },
        );
      });
    },
  };
}

function firstLine(s: string): string {
  return s.split(/\r?\n/).find((l) => l.trim()) ?? "";
}
