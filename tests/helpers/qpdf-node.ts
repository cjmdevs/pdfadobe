// Node runner for the engine's qpdf jobs (tests, dev server, MCP server). Same rules as
// the Tauri command: a private temp folder, plain file names only, deleted afterwards.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { qpdfBin } from "../corpus/generate.mjs";
import { checkJob, QpdfError, type Qpdf, type QpdfJob } from "../../src/engine/pages/qpdf";

export function nodeQpdf(bin = qpdfBin()): Qpdf {
  return {
    run(job: QpdfJob) {
      checkJob(job);
      const dir = mkdtempSync(join(tmpdir(), "pdfwb-qpdf-"));
      for (const [name, bytes] of Object.entries(job.inputs)) writeFileSync(join(dir, name), bytes);
      return new Promise((resolve, reject) => {
        execFile(
          bin,
          job.args,
          { cwd: dir, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
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
