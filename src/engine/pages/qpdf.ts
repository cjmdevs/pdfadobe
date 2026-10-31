// qpdf as a page-assembly engine. qpdf copies form fields across files and renames
// clashing ones ("name" -> "name+1"), keeps annotations, and moves bookmarks with their
// pages. PDFium's importPages does none of that (it drops /AcroForm entirely).
//
// The engine never touches the file system: a `Qpdf` runner owns a private job folder.
// The app's runner is a Tauri command (src-tauri/src/qpdf_job.rs), Node's is
// tests/helpers/qpdf-node.ts. Both enforce `checkJob`.

export interface QpdfJob {
  /** Files written into the job folder before qpdf runs, by plain name ("in0.pdf"). */
  inputs: Record<string, Uint8Array>;
  /** qpdf arguments. File arguments are plain names from `inputs` / `outputs`. */
  args: string[];
  /** Files read back from the job folder after qpdf exits. */
  outputs: string[];
}

export interface QpdfResult {
  files: Record<string, Uint8Array>;
  /** Standard output (only used for --json). May hold document data: never log it. */
  stdout: string;
  /** qpdf exit code 3: it succeeded but warned (usually about repaired damage). */
  warnings: boolean;
}

export interface Qpdf {
  run(job: QpdfJob): Promise<QpdfResult>;
}

export class QpdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QpdfError";
  }
}

const FILE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}\.(pdf|json)$/;

/**
 * Rejects anything that could reach outside the job folder: path separators, "..",
 * drive letters, qpdf's @argfile expansion, and file names that are not plain lowercase
 * names. Runners call this before writing a single byte.
 */
export function checkJob(job: QpdfJob): void {
  const names = [...Object.keys(job.inputs), ...job.outputs];
  for (const n of names) {
    if (!FILE_NAME.test(n)) throw new QpdfError(`invalid job file name: ${n}`);
  }
  for (const a of job.args) {
    if (a.startsWith("@")) throw new QpdfError("argument files are not allowed");
    if (/[\\/]/.test(a) || a.includes("..") || /(^|=)[a-z]:/i.test(a)) {
      throw new QpdfError(`invalid qpdf argument: ${a}`);
    }
  }
  checkJobFiles(job);
}

/** Keys a `--job-json-file` may use (Phase 8); it names files by plain job names only. */
const JOB_FILE_KEYS = new Set([
  "inputFile",
  "outputFile",
  "password",
  "decrypt",
  "encrypt",
  "showEncryption",
]);

/** Same as the Tauri runner's check_job_files: a job file may not reach outside the folder. */
export function checkJobFiles(job: QpdfJob): void {
  for (const a of job.args) {
    if (!a.startsWith("--job-json-file=")) continue;
    const bytes = job.inputs[a.slice("--job-json-file=".length)];
    if (!bytes) throw new QpdfError("the qpdf job file is missing");
    let v: unknown;
    try {
      v = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new QpdfError("the qpdf job file is not valid");
    }
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      throw new QpdfError("the qpdf job file is not valid");
    }
    for (const [k, val] of Object.entries(v)) {
      if (!JOB_FILE_KEYS.has(k)) throw new QpdfError(`qpdf job file key not allowed: ${k}`);
      if (
        (k === "inputFile" || k === "outputFile") &&
        !(typeof val === "string" && FILE_NAME.test(val))
      ) {
        throw new QpdfError("invalid job file name in the qpdf job file");
      }
    }
  }
}

/** Runs a job and returns its single output, or throws if qpdf did not produce it. */
export async function runToFile(qpdf: Qpdf, job: QpdfJob): Promise<Uint8Array> {
  const out = job.outputs[0];
  if (!out) throw new QpdfError("job has no output");
  const r = await qpdf.run(job);
  const bytes = r.files[out];
  if (!bytes) throw new QpdfError("qpdf produced no output");
  return bytes;
}
