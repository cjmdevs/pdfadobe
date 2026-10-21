// Document properties for the Properties dialog (and later the MCP server).
// Node-safe: no DOM. Works with both the in-thread PdfiumNative (tests, MCP) and the
// worker PdfEngine (app) through the small `MetadataSource` interface.

import type { PdfDocumentObject, PdfMetadataObject } from "@embedpdf/models";

export interface MetadataSource {
  getMetadata(doc: PdfDocumentObject): { toPromise(): Promise<PdfMetadataObject> };
}

/** Bits from FPDF_GetDocPermissions (PDF 32000-1 Table 22). Same values as PdfPermissionFlag. */
const PERMISSION_BITS = [
  ["print", 4],
  ["printHighQuality", 2048],
  ["modifyContents", 8],
  ["copyContents", 16],
  ["modifyAnnotations", 32],
  ["fillForms", 256],
  ["extractForAccessibility", 512],
  ["assembleDocument", 1024],
] as const;

export type PermissionName = (typeof PERMISSION_BITS)[number][0];
export type Permissions = Record<PermissionName, boolean>;

export interface DocumentProperties {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: Date | null;
  modificationDate: Date | null;
  pdfVersion: string | null;
  pageCount: number;
  fileSize: number;
  linearized: boolean;
  encrypted: boolean;
  permissions: Permissions;
}

/** "1.7" from the `%PDF-1.7` header, or null if the header is missing or malformed. */
export function pdfHeaderVersion(bytes: Uint8Array): string | null {
  // The header may be preceded by junk; the spec (and Acrobat) allow it in the first 1 KB.
  const head = latin1(bytes.subarray(0, 1024));
  const m = /%PDF-(\d\.\d)/.exec(head);
  return m?.[1] ?? null;
}

/** "Fast Web View" in Acrobat: a /Linearized dictionary in the first object. */
export function isLinearized(bytes: Uint8Array): boolean {
  return /\/Linearized\s/.test(latin1(bytes.subarray(0, 1024)));
}

export function decodePermissions(flags: number, encrypted: boolean): Permissions {
  // Unencrypted files report 0xFFFFFFFF; treat as "everything allowed".
  const out = {} as Permissions;
  for (const [name, bit] of PERMISSION_BITS) out[name] = !encrypted || (flags & bit) !== 0;
  return out;
}

export async function documentProperties(
  engine: MetadataSource,
  doc: PdfDocumentObject,
  bytes: Uint8Array,
): Promise<DocumentProperties> {
  const m = await engine.getMetadata(doc).toPromise();
  return {
    title: blankToNull(m.title),
    author: blankToNull(m.author),
    subject: blankToNull(m.subject),
    keywords: blankToNull(m.keywords),
    creator: blankToNull(m.creator),
    producer: blankToNull(m.producer),
    creationDate: m.creationDate,
    modificationDate: m.modificationDate,
    pdfVersion: pdfHeaderVersion(bytes),
    pageCount: doc.pageCount,
    fileSize: bytes.byteLength,
    linearized: isLinearized(bytes),
    encrypted: doc.isEncrypted,
    permissions: decodePermissions(doc.permissions, doc.isEncrypted),
  };
}

const NAMED_SIZES: [string, number, number][] = [
  ["Letter", 612, 792],
  ["Legal", 612, 1008],
  ["Tabloid", 792, 1224],
  ["A4", 595.28, 841.89],
  ["A3", 841.89, 1190.55],
  ["A5", 419.53, 595.28],
];

/** `8.50 x 11.00 in (Letter)`. Points in, like PDFium page sizes. Rotation-agnostic name match. */
export function formatPageSize(widthPt: number, heightPt: number): string {
  const inch = (pt: number) => (pt / 72).toFixed(2);
  const short = Math.min(widthPt, heightPt);
  const long = Math.max(widthPt, heightPt);
  const named = NAMED_SIZES.find(([, w, h]) => Math.abs(w - short) < 2 && Math.abs(h - long) < 2);
  const base = `${inch(widthPt)} x ${inch(heightPt)} in`;
  return named ? `${base} (${named[0]})` : base;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function blankToNull(s: string | null): string | null {
  return s && s.trim() ? s : null;
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}
