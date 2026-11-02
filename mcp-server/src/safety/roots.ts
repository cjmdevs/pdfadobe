// The folders the server may touch: only those listed in the extension's config.
//
// Every path Claude gives is resolved to its real, final location (junctions,
// symbolic links, subst drives and 8.3 short names resolved by Windows itself through
// fs.realpath.native) and must then lie inside one of the configured folders, compared
// the way Windows compares paths (case-insensitive). Paths are never trusted as typed.
import { realpath } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, sep } from "node:path";
import { promisify } from "node:util";

/** Windows' own final path for an existing file (GetFinalPathNameByHandle). */
export const realpathNative = promisify(realpath.native);

export class PathRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathRefused";
  }
}

/** A configured folder, resolved. */
export interface Root {
  /** Real path, no trailing separator (except a drive root like "C:\"). */
  path: string;
}

export interface Resolved {
  /** Real path of the file or folder. */
  path: string;
  root: Root;
}

const key = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/** `child` is `parent` itself or lies inside it (both real paths). */
export function isInside(child: string, parent: string): boolean {
  const c = key(child);
  const p = key(parent.endsWith(sep) ? parent : parent + sep);
  return c === key(parent) || c.startsWith(p);
}

/**
 * Rejects path forms that could name something other than a plain file: device and
 * \\?\ namespaces, alternate data streams ("file.pdf:hidden"), relative paths.
 */
export function checkPathForm(p: string): void {
  if (typeof p !== "string" || !p.trim()) throw new PathRefused("a full path is required");
  if (p.includes("\0")) throw new PathRefused("invalid path");
  if (/^[\\/]{2}[?.][\\/]/.test(p)) throw new PathRefused("device paths are not allowed");
  if (!isAbsolute(p)) throw new PathRefused("use a full path (from list_pdfs)");
  const rest = /^[a-zA-Z]:/.test(p) ? p.slice(2) : p;
  if (rest.includes(":")) throw new PathRefused("alternate data streams are not allowed");
}

export class Roots {
  private constructor(readonly list: Root[]) {}

  /** Resolves each configured folder. A folder that does not exist is an error. */
  static async create(folders: string[]): Promise<Roots> {
    if (!folders.length) throw new Error("no folders configured: add at least one in settings");
    const list: Root[] = [];
    for (const f of folders) {
      checkPathForm(f);
      const real = await realpathNative(f).catch(() => {
        throw new Error(`configured folder not found: ${f}`);
      });
      if (!(await stat(real)).isDirectory()) throw new Error(`not a folder: ${f}`);
      list.push({ path: real });
    }
    return new Roots(list);
  }

  /** The configured folder that holds `real`, or null. Innermost wins when they nest. */
  rootOf(real: string): Root | null {
    let best: Root | null = null;
    for (const r of this.list) {
      if (isInside(real, r.path) && (!best || r.path.length > best.path.length)) best = r;
    }
    return best;
  }

  /** An existing file or folder inside a configured folder. */
  async resolve(p: string): Promise<Resolved> {
    checkPathForm(p);
    let real: string;
    try {
      real = await realpathNative(p);
    } catch {
      throw new PathRefused("file not found");
    }
    const root = this.rootOf(real);
    if (!root) throw new PathRefused("outside the folders this extension may use");
    return { path: real, root };
  }

  /** An existing PDF file inside a configured folder. */
  async resolvePdf(p: string): Promise<Resolved> {
    const r = await this.resolve(p);
    if (!(await stat(r.path)).isFile()) throw new PathRefused("not a file");
    if (!/\.pdf$/i.test(r.path)) throw new PathRefused("not a .pdf file");
    return r;
  }
}
