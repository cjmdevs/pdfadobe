// Node runner for the engine's OCR jobs (MCP server and tests). Same rules as the Tauri
// command (src-tauri/src/ocr_job.rs): the bundled sidecar only, a private job folder,
// plain file names only, deleted afterwards. Like the qpdf runner, job folders go
// under `workBase` (the task's _workspace folder in the MCP server).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkOcrJob, OcrError, type Ocr, type OcrJob } from "../../../src/engine/ocr/tesseract";

export function nodeOcr(dir: string, workBase: () => string): Ocr {
  const exe = join(dir, "tesseract.exe");
  if (!existsSync(exe)) {
    throw new Error("The OCR sidecar is missing: run `npm run build-tesseract`.");
  }
  const running = new Map<number, ChildProcess>();
  return {
    run(job: OcrJob) {
      checkOcrJob(job);
      const work = mkdtempSync(join(workBase(), "ocr-"));
      for (const [name, bytes] of Object.entries(job.inputs))
        writeFileSync(join(work, name), bytes);
      return new Promise((resolve, reject) => {
        const child = spawn(exe, [...job.args, "--tessdata-dir", join(dir, "tessdata")], {
          cwd: work,
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        });
        running.set(job.id, child);
        let stdout = "";
        child.stdout?.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
        child.on("error", (e) => {
          running.delete(job.id);
          rmSync(work, { recursive: true, force: true });
          reject(new OcrError(`could not run Tesseract: ${e.message}`));
        });
        child.on("close", (code) => {
          running.delete(job.id);
          try {
            if (code !== 0) {
              reject(new OcrError(`Tesseract stopped (exit ${code ?? -1})`));
              return;
            }
            const files: Record<string, Uint8Array> = {};
            for (const o of job.outputs) {
              try {
                files[o] = new Uint8Array(readFileSync(join(work, o)));
              } catch {
                // missing output: the engine reports it
              }
            }
            resolve({ files, stdout });
          } finally {
            rmSync(work, { recursive: true, force: true });
          }
        });
      });
    },
    async cancel(id: number) {
      running.get(id)?.kill();
    },
  };
}
