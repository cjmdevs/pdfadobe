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
/** qpdf executable: $QPDF, PATH, or src-tauri/vendor/qpdf/qpdf.exe. Throws if none. */
export function qpdfBin(): string;
export function generateCorpus(opts?: { force?: boolean }): Promise<string[]>;
