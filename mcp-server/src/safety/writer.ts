// The only module that writes files. Inside a configured folder it may create:
//
//   <root>\_workspace\<YYYY-MM-DD>_<task>\   copies of originals, qpdf/OCR job folders
//   <root>\_workspace\_audit\                the audit log
//   <root>\Outputs\                          finished files
//
// Nothing is ever written, renamed, moved or deleted anywhere else. Originals are only
// read (and copied). Files are created with exclusive flags, so nothing existing is
// ever overwritten: a name that is taken gets " (2)", " (3)", ...
//
// Each folder level is created one at a time and then resolved by Windows; if any
// level turns out to be a junction or link that leads elsewhere, the write is refused.
import { constants } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { isInside, PathRefused, realpathNative, type Resolved, type Root } from "./roots";

export const WORKSPACE = "_workspace";
export const OUTPUTS = "Outputs";
export const AUDIT = "_audit";

/**
 * Hides anything that looks like an SSN, ITIN, EIN or account number in a name we
 * create (firm rule: never put those in file names). Digits become "X".
 */
export function maskIds(s: string): string {
  const x = (m: string) => m.replace(/\d/g, "X");
  return s
    .replace(/(?<!\d)\d{3}[- ]?\d{2}[- ]?\d{4}(?!\d)/g, x)
    .replace(/(?<!\d)\d{2}[- ]?\d{7}(?!\d)/g, x)
    .replace(/\d{7,}/g, x);
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** One safe file-name component: no folders, no reserved names, IDs masked. */
export function safeName(name: string, fallback: string): string {
  let n = maskIds(basename(name.replaceAll("\\", "/")))
    // eslint-disable-next-line no-control-regex -- control characters are invalid in Windows names
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim();
  if (!n || n === "." || n === ".." || RESERVED.test(n)) n = fallback;
  return n.slice(0, 120);
}

/** A task name for the workspace folder: letters, digits, space, - and _ only. */
export function safeTask(task: string | undefined, fallback: string): string {
  const t = maskIds(task ?? "")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  return t || fallback;
}

/** Local date as YYYY-MM-DD. */
export function today(d = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** `<root>\_workspace` or `<root>\Outputs` (or inside them). */
export function isWritable(real: string, root: Root): boolean {
  return isInside(real, join(root.path, WORKSPACE)) || isInside(real, join(root.path, OUTPUTS));
}

const sameKey = (a: string, b: string) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Creates `<root>\a\b\...` level by level; each level must resolve to exactly itself. */
export async function ensureDir(root: Root, parts: string[]): Promise<string> {
  if (parts[0] !== WORKSPACE && parts[0] !== OUTPUTS) {
    throw new PathRefused("writes go only to _workspace or Outputs");
  }
  let dir = root.path;
  for (const part of parts) {
    if (safeName(part, "") !== part) throw new PathRefused("invalid folder name");
    dir = join(dir, part);
    await mkdir(dir).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    const real = await realpathNative(dir);
    if (!sameKey(real, dir)) throw new PathRefused(`${part} is a link to another place`);
  }
  if (!isWritable(dir, root)) throw new PathRefused("writes go only to _workspace or Outputs");
  return dir;
}

/** Tries `name`, then "stem (2).ext", ... until `create` succeeds without overwriting. */
async function unique(
  dir: string,
  name: string,
  create: (path: string) => Promise<void>,
): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const p = join(dir, i === 1 ? name : `${stem} (${i})${ext}`);
    try {
      await create(p);
      return p;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error("too many files with the same name");
}

/** One tool call that changes files: a task folder in _workspace, results to Outputs. */
export class Job {
  private constructor(
    readonly root: Root,
    /** The task folder: `<root>\_workspace\<date>_<task>`. */
    readonly dir: string,
  ) {}

  static async start(root: Root, task: string): Promise<Job> {
    return new Job(root, await ensureDir(root, [WORKSPACE, `${today()}_${task}`]));
  }

  /** Copies an original into the task folder (the original is only read). */
  async copyIn(src: Resolved): Promise<string> {
    const name = safeName(basename(src.path), "input.pdf");
    return unique(this.dir, name, (p) => copyFile(src.path, p, constants.COPYFILE_EXCL));
  }

  /** A finished file into `<root>\Outputs\`. Returns its path. */
  async publish(name: string, bytes: Uint8Array): Promise<string> {
    const dir = await ensureDir(this.root, [OUTPUTS]);
    const n = safeName(name, "output.pdf");
    return unique(dir, /\.pdf$/i.test(n) ? n : `${n}.pdf`, (p) =>
      writeFile(p, bytes, { flag: "wx" }),
    );
  }
}
