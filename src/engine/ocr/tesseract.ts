// Tesseract as the OCR engine (Phase 7). Same shape as `Qpdf`: the engine never touches
// the file system; a runner owns a private job folder and runs tesseract.exe there.
// The app's runner is a Tauri command (src-tauri/src/ocr_job.rs), Node's is
// tests/helpers/ocr-node.ts. Both enforce `checkOcrJob` and add `--tessdata-dir`.
//
// No config files are used (the sidecar ships none): outputs are switched on with
// `-c tessedit_create_*=1`.

export interface OcrJob {
  /** Lets `cancel` find the running process. Unique per runner. */
  id: number;
  /** Files written into the job folder before tesseract runs ("page.pgm"). */
  inputs: Record<string, Uint8Array>;
  /** tesseract arguments: `in.pgm outbase [options]`. */
  args: string[];
  /** Files read back after tesseract exits ("outbase.pdf"). */
  outputs: string[];
}

export interface OcrResult {
  files: Record<string, Uint8Array>;
  /** Standard output. Holds recognised text or OSD lines: never log it. */
  stdout: string;
}

export interface Ocr {
  run(job: OcrJob): Promise<OcrResult>;
  /** Kills job `id` if it is still running; its `run` then rejects with `OcrCancelled`. */
  cancel(id: number): Promise<void>;
}

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrError";
  }
}

export class OcrCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "OcrCancelled";
  }
}

const FILE = /^[a-z0-9][a-z0-9_-]{0,63}\.(pgm|pdf|txt|tsv|osd)$/;
const BASE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FLAGS = new Set(["-l", "--psm", "--oem", "--dpi", "-c"]);
const LANG = /^(eng|osd)$/;
const PARAM = /^(textonly_pdf|tessedit_create_(pdf|txt|tsv))=[01]$/;

/**
 * Rejects anything but plain job file names and a small allowlist of options, so a job
 * can never read or write outside its folder or load a config file. Runners call this
 * before writing a single byte (the Rust runner has the same rules).
 */
export function checkOcrJob(job: OcrJob): void {
  if (!Number.isSafeInteger(job.id) || job.id < 0) throw new OcrError("invalid job id");
  for (const n of [...Object.keys(job.inputs), ...job.outputs]) {
    if (!FILE.test(n)) throw new OcrError(`invalid job file name: ${n}`);
  }
  const [input, base, ...rest] = job.args;
  if (!input || !FILE.test(input) || !base || !BASE.test(base)) {
    throw new OcrError("a job starts with an input file and an output name");
  }
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i] ?? "";
    const value = rest[i + 1] ?? "";
    const ok =
      FLAGS.has(flag) &&
      (flag === "-l"
        ? LANG.test(value)
        : flag === "-c"
          ? PARAM.test(value)
          : /^\d{1,4}$/.test(value));
    if (!ok) throw new OcrError(`invalid tesseract argument: ${flag} ${value}`);
  }
}
