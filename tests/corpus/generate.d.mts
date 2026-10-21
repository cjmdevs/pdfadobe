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
export function generateCorpus(opts?: { force?: boolean }): Promise<string[]>;
