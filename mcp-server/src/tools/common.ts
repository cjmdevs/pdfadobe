// Shared pieces of the tools: argument schemas, page ranges, the "change a copy and
// publish to Outputs" flow, and facts about a PDF (never its text).
import { basename, extname } from "node:path";
import * as z from "zod/v4";
import type { PagesCtx } from "../../../src/engine/pages/context";
import { RawDoc } from "../../../src/engine/pages/raw";
import { parseRanges } from "../../../src/engine/pages/ranges";
import { pageHasText } from "../../../src/engine/ocr";
import type { PdfiumModule } from "../../../src/engine/pdfium";
import { Call, ToolError } from "../server";
import type { Job } from "../safety/writer";

export const PATH_DESC =
  "Full path of a PDF inside a configured folder (copy it exactly from list_pdfs).";

export const path = z.string().min(3).describe(PATH_DESC);

export const task = z
  .string()
  .max(40)
  .optional()
  .describe(
    "Short task name for the working folder, e.g. 'JD 2025 merge'. Use client initials or a file number, never an SSN/EIN/account number. Defaults to the tool name.",
  );

export const outputName = z
  .string()
  .max(120)
  .optional()
  .describe(
    "File name for the result in Outputs (no folder). Defaults to '<original>_<action>.pdf'. Never put an SSN/EIN/account number in it.",
  );

export const pages = z
  .string()
  .max(500)
  .optional()
  .describe('1-based page range like "1-3, 5, 8-z" (z = last page). All pages when left out.');

/** 1-based range text -> 0-based indices; records the range for the audit log. */
export function pageList(call: Call, text: string | undefined, pageCount: number): number[] {
  if (text?.trim()) call.pages = call.pages ? `${call.pages}; ${text.trim()}` : text.trim();
  return parseRanges(text ?? "", pageCount);
}

/** "Return 2024.pdf" + "Rotated" -> "Return 2024_Rotated.pdf" */
export function derivedName(srcPath: string, suffix: string): string {
  const b = basename(srcPath);
  return `${b.slice(0, b.length - extname(b).length)}_${suffix}.pdf`;
}

export interface PdfFacts {
  pages: number | null;
  size_bytes: number;
  is_encrypted: boolean;
  /** Opening needs a password. */
  needs_password: boolean;
  has_text: boolean | null;
  has_forms: boolean | null;
  has_signatures: boolean;
}

const FPDF_ERR_PASSWORD = 4;
const latin1 = new TextDecoder("latin1");

/** Facts from PDFium directly; no text leaves this function. */
export function pdfFacts(m: PdfiumModule, bytes: Uint8Array): PdfFacts {
  const raw = latin1.decode(bytes);
  const base = {
    size_bytes: bytes.byteLength,
    has_signatures: /\/ByteRange\s*\[/.test(raw),
  };
  let doc: RawDoc;
  try {
    doc = RawDoc.open(m, bytes);
  } catch {
    const needsPassword = m.FPDF_GetLastError() === FPDF_ERR_PASSWORD;
    if (!needsPassword) throw new ToolError("This PDF could not be opened (it may be damaged).");
    return {
      ...base,
      pages: null,
      is_encrypted: true,
      needs_password: true,
      has_text: null,
      has_forms: null,
    };
  }
  try {
    let hasText = false;
    for (let i = 0; i < doc.pageCount && !hasText; i++) hasText = pageHasText(m, doc, i);
    return {
      ...base,
      pages: doc.pageCount,
      is_encrypted: m.FPDF_GetSecurityHandlerRevision(doc.ptr) !== -1,
      needs_password: false,
      has_text: hasText,
      has_forms: m.FPDF_GetFormType(doc.ptr) !== 0,
    };
  } finally {
    doc.close();
  }
}

export function pageCount(m: PdfiumModule, bytes: Uint8Array): number {
  const doc = RawDoc.open(m, bytes);
  try {
    return doc.pageCount;
  } finally {
    doc.close();
  }
}

/** Refuses password-protected files (changing them would drop or break the protection). */
export function assertEditable(m: PdfiumModule, bytes: Uint8Array): PdfFacts {
  const f = pdfFacts(m, bytes);
  if (f.is_encrypted) {
    throw new ToolError(
      "This PDF is password-protected. Remove the security in PDF Workbench first (Protect > Remove Security).",
    );
  }
  return f;
}

export interface OutputFacts {
  path: string;
  pages: number;
  size_bytes: number;
}

export interface Changed {
  job: Job;
  /** Bytes of the copy in the task folder. */
  bytes: Uint8Array;
  ctx: PagesCtx;
  pageCount: number;
  srcPath: string;
}

/**
 * The flow every one-file change follows: resolve the original, copy it into
 * `_workspace\<date>_<task>\`, change the copy's bytes, publish the result to Outputs.
 */
export async function changeCopy(
  call: Call,
  args: { path: string; task?: string | undefined; output_name?: string | undefined },
  suffix: string,
  change: (c: Changed) => Promise<Uint8Array>,
): Promise<{ output: OutputFacts; warnings: string[]; input: Changed }> {
  const src = await call.pdf(args.path);
  const job = await call.job(src.root, args.task);
  const copy = await job.copyIn(src);
  const bytes = await call.read({ path: copy, root: src.root });
  const { rt } = call.deps;
  const facts = assertEditable(rt.module, bytes);
  const c: Changed = {
    job,
    bytes,
    ctx: { engine: rt.engine, module: rt.module, qpdf: rt.qpdf(job.dir) },
    pageCount: facts.pages ?? 0,
    srcPath: src.path,
  };
  const out = await change(c);
  const outPath = await call.publish(job, args.output_name ?? derivedName(src.path, suffix), out);
  const warnings = facts.has_signatures
    ? ["The original has a digital signature; the new file's signature is no longer valid."]
    : [];
  return {
    output: { path: outPath, pages: pageCount(rt.module, out), size_bytes: out.byteLength },
    warnings,
    input: c,
  };
}

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
/** Creates new files only; originals are never changed. */
export const CREATES_FILES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
