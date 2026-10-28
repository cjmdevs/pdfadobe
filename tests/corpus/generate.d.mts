export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const OUT_DIR: string;
export const FAKE_SSN: string;
export const ENCRYPTED_PASSWORDS: { user: string; owner: string };
export const SSN_LAYOUT: {
  keepText: string;
  formField: { name: string; rect: PdfRect };
  areaZone: PdfRect;
  areaImage: PdfRect;
  areaVector: PdfRect;
};
export const LEAK_FILES: {
  file: string;
  what: string;
  /** Area boxes on top of the search hits (0-based page). */
  areas: { page: number; rect: PdfRect }[];
  /** Text that must survive (checked in page text or OCR). */
  keep: string;
  /** Run Sanitize Document with the redaction. */
  sanitize: boolean;
  /** The SSN exists only as image pixels (OCR is the only check that can see it). */
  pixelsOnly?: boolean;
}[];
export interface NavOutlineItem {
  title: string;
  page: number;
  children?: NavOutlineItem[];
}
export const NAV_LAYOUT: {
  pages: { label: string; size: [number, number]; rotate?: number }[];
  outline: NavOutlineItem[];
  attachments: { name: string; mimeType: string; description: string }[];
};
export const WORKPAPERS: {
  file: string;
  id: string;
  values: { "client.name": string; "tie.out": boolean; status: string };
  outline: NavOutlineItem[];
  note: string;
}[];
/** PNG file bytes. colorType 0 = gray (1 byte/px), 6 = RGBA. */
export function png(width: number, height: number, colorType: 0 | 6, pixels: Uint8Array): Buffer;
/** qpdf executable: $QPDF, PATH, or src-tauri/vendor/qpdf/qpdf.exe. Throws if none. */
export function qpdfBin(): string;
export function generateCorpus(opts?: { force?: boolean }): Promise<string[]>;
