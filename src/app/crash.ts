// Local crash reports (Phase 10a). Node-safe: no React or DOM here except
// installCrashHandlers, which takes the window it listens on.
//
// A report never contains document text or file names (CLAUDE.md: logs never contain
// document text). What is kept: when, the app version, where it happened (kind and
// stack frames: function names and positions in our own code) and the error type.
// The message is kept only for JavaScript's own errors about code (TypeError and the
// like, e.g. "x is not a function"), and even then quoted parts, paths and numbers are
// cut. Every other message is replaced by its length and a short hash, so two reports of
// the same error can still be matched without showing it.
//
// Reports are written by Rust to %LOCALAPPDATA%\com.mgrcpas.pdfworkbench\crashes\
// (newest 20 kept) and never sent anywhere.

export type CrashKind = "error" | "unhandledrejection" | "render" | "worker";

export interface CrashReport {
  time: string;
  version: string;
  kind: CrashKind;
  name: string;
  message: string;
  stack: string[];
}

const CODE_ERRORS = new Set(["TypeError", "RangeError", "ReferenceError", "SyntaxError"]);

/** Removes anything that could be document or file data from a code error message. */
export function scrubMessage(m: string): string {
  return (
    m
      .replace(/"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”|‘[^’]*’/g, "[…]")
      // A Windows path may hold spaces, so its end can't be found: cut to the end.
      .replace(/(\\\\|\b[A-Za-z]:[\\/]|file:\/\/).*$/s, "[path…]")
      .replace(/\d{3,}/g, "[n]")
      .slice(0, 200)
  );
}

/** FNV-1a, 32 bit, hex: enough to match repeats, says nothing about the text. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Stack frames as "function (file:line:col)" with only our bundle's file name kept
 * (no folders: the install path holds the Windows user name). Frames from outside the
 * app (extensions, eval'd code) keep only the function name.
 */
export function scrubStack(stack: string | undefined): string[] {
  if (!stack) return [];
  const out: string[] = [];
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    // V8: "at fn (url:1:2)" or "at url:1:2"; Firefox/WebKit: "fn@url:1:2"
    const m =
      /^at (?:(.+?) )?\(?(.+?):(\d+):(\d+)\)?$/.exec(line) ??
      /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line);
    if (!m) continue;
    const fn = (m[1] ?? "").replace(/[^\w$.<>[\] ]/g, "").slice(0, 80) || "<anonymous>";
    const file = /([\w.-]+\.(?:js|mjs|ts|tsx|wasm))(?:\?|$)/.exec(m[2] ?? "")?.[1] ?? "?";
    out.push(`${fn} (${file}:${m[3]}:${m[4]})`);
    if (out.length >= 40) break;
  }
  return out;
}

export function buildReport(
  kind: CrashKind,
  error: unknown,
  version: string,
  now: Date = new Date(),
): CrashReport {
  const e = error instanceof Error ? error : null;
  const name = e ? e.name.replace(/[^\w]/g, "").slice(0, 60) || "Error" : typeof error;
  const msg = e ? e.message : String(error);
  const message = CODE_ERRORS.has(name)
    ? scrubMessage(msg)
    : `(message withheld: ${msg.length} characters, hash ${shortHash(msg)})`;
  return {
    time: now.toISOString(),
    version,
    kind,
    name,
    message,
    stack: scrubStack(e?.stack),
  };
}

/** Plain text for the report file. */
export function formatReport(r: CrashReport): string {
  return (
    `PDF Workbench crash report\n` +
    `Time: ${r.time}\nVersion: ${r.version}\nWhere: ${r.kind}\n` +
    `Error: ${r.name}\nMessage: ${r.message}\n\nStack:\n` +
    (r.stack.length ? r.stack.map((f) => `  ${f}`).join("\n") : "  (none)") +
    "\n\nThis report holds no document text or file names. It was not sent anywhere.\n"
  );
}

/**
 * Listens for uncaught errors and unhandled promise rejections. `write` saves one
 * report; at most 5 are written per session so a loop of errors cannot fill the disk.
 */
/** What installCrashHandlers needs from a window (structural, so this file stays
 * free of DOM types and runs in Node tests). */
export interface CrashTarget {
  addEventListener(type: "error" | "unhandledrejection", listener: (ev: unknown) => void): void;
}

export function installCrashHandlers(
  target: CrashTarget,
  version: string,
  write: (text: string) => Promise<void>,
): (kind: CrashKind, error: unknown) => void {
  let left = 5;
  const record = (kind: CrashKind, error: unknown) => {
    if (left <= 0) return;
    left--;
    void write(formatReport(buildReport(kind, error, version))).catch(() => {});
  };
  target.addEventListener("error", (ev) => {
    const e = ev as { error?: unknown; message?: string };
    // Resource load errors (an <img> that failed) are not crashes.
    if (e.error === undefined && !e.message) return;
    record("error", e.error ?? new Error(e.message ?? ""));
  });
  target.addEventListener("unhandledrejection", (ev) => {
    record("unhandledrejection", (ev as { reason?: unknown }).reason);
  });
  return record;
}

/** Files open in this window, for the crash screen's "Open in Acrobat" (kept by the
 * workbench; the crash screen can't use React state that just failed). */
let openFiles: string[] = [];
export function setOpenFiles(paths: string[]): void {
  openFiles = [...paths];
}
export function getOpenFiles(): string[] {
  return openFiles;
}
