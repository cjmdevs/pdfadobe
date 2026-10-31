// Password security (Phase 8), through qpdf: AES-256 only (PDF 2.0 / R6). Passwords go
// to qpdf in a job file inside its private job folder (`--job-json-file`), never on the
// command line where other programs could see them, and never into a log.
//
// A permissions password is not real protection: anyone who can open the file can
// remove the restrictions with common tools. Only an open password encrypts the content
// against people who do not know it.

import { runToFile, QpdfError, type Qpdf } from "./pages/qpdf";

export type PrintAllowed = "full" | "low" | "none";
/** What changes are allowed (Acrobat's "Changes Allowed" list). */
export type ChangesAllowed = "all" | "annotate" | "form" | "assembly" | "none";

export interface ProtectOptions {
  /** Needed to open the document. Empty: anyone can open it. */
  openPassword: string;
  /** Needed to change the restrictions. Empty: no restrictions are set. */
  permissionsPassword: string;
  print: PrintAllowed;
  changes: ChangesAllowed;
  /** Copying text and images out. */
  copy: boolean;
}

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

/** A random owner password when only an open password is set (all permissions allowed). */
function randomPassword(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

/** A protected copy of `bytes` (which must not be protected already). */
export async function protectPdf(
  qpdf: Qpdf,
  bytes: Uint8Array,
  o: ProtectOptions,
): Promise<Uint8Array> {
  if (!o.openPassword && !o.permissionsPassword) {
    throw new SecurityError("Set an open password, a permissions password, or both.");
  }
  if (o.openPassword && o.openPassword === o.permissionsPassword) {
    throw new SecurityError("The open password and the permissions password must be different.");
  }
  const restricted = o.permissionsPassword !== "";
  const bits: Record<string, string> = restricted
    ? {
        print: o.print,
        modify: o.changes === "none" ? "none" : o.changes,
        extract: o.copy ? "y" : "n",
        // Screen readers keep access (Acrobat's default).
        accessibility: "y",
      }
    : {};
  const job = {
    inputFile: "in0.pdf",
    outputFile: "out.pdf",
    encrypt: {
      userPassword: o.openPassword,
      ownerPassword: restricted ? o.permissionsPassword : randomPassword(),
      "256bit": bits,
    },
  };
  return runToFile(qpdf, {
    inputs: { "in0.pdf": bytes, "job.json": json(job) },
    args: ["--job-json-file=job.json"],
    outputs: ["out.pdf"],
  }).catch((e: unknown) => {
    throw e instanceof QpdfError && /password/i.test(e.message)
      ? new SecurityError("This document is already protected. Remove its security first.")
      : e;
  });
}

/** An unprotected copy of a protected document, given its open or permissions password. */
export async function removeSecurity(
  qpdf: Qpdf,
  bytes: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  const job = { inputFile: "in0.pdf", password, outputFile: "out.pdf", decrypt: "" };
  return runToFile(qpdf, {
    inputs: { "in0.pdf": bytes, "job.json": json(job) },
    args: ["--job-json-file=job.json"],
    outputs: ["out.pdf"],
  }).catch((e: unknown) => {
    throw e instanceof QpdfError && /password/i.test(e.message)
      ? new SecurityError("That password is not correct.")
      : e;
  });
}

export interface SecurityInfo {
  encrypted: boolean;
  /** "AES-256" etc., from qpdf --show-encryption. */
  method: string | null;
  /** An open password is needed (the empty password does not open it). */
  needsOpenPassword: boolean;
  /** qpdf's permission lines: "print high resolution" -> allowed. */
  permissions: Record<string, boolean>;
}

/** What protects a document (for tests and the Protect dialog). */
export async function securityInfo(
  qpdf: Qpdf,
  bytes: Uint8Array,
  password = "",
): Promise<SecurityInfo> {
  const job = { inputFile: "in0.pdf", password, showEncryption: "" };
  try {
    const r = await qpdf.run({
      inputs: { "in0.pdf": bytes, "job.json": json(job) },
      args: ["--job-json-file=job.json"],
      outputs: [],
    });
    const out = r.stdout;
    if (/File is not encrypted/i.test(out)) {
      return { encrypted: false, method: null, needsOpenPassword: false, permissions: {} };
    }
    const aes256 = /R = 6/.test(out) && /AESv3/.test(out);
    const permissions: Record<string, boolean> = {};
    for (const m of out.matchAll(/^([a-z ]+): (allowed|not allowed)\s*$/gm)) {
      if (m[1]) permissions[m[1]] = m[2] === "allowed";
    }
    return {
      encrypted: true,
      method: aes256 ? "AES-256" : (/stream encryption method: (\S+)/.exec(out)?.[1] ?? "other"),
      needsOpenPassword: /Incorrect password supplied/i.test(out),
      permissions,
    };
  } catch (e) {
    if (e instanceof QpdfError && /password/i.test(e.message)) {
      return { encrypted: true, method: null, needsOpenPassword: true, permissions: {} };
    }
    throw e;
  }
}
