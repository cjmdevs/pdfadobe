// Numbers printed on a page (Phase 4 stage 3): for "click a number to send it to the
// calculator" and foot/cross-foot. Only pages with a text layer have them (scans need
// OCR first). Values never go to the log. Node-safe.

import type { PdfiumModule } from "../pdfium";
import { RawDoc } from "../pages/raw";
import { pageChars, type PageChar, type Rect } from "../edit/chars";

export interface PageNumber {
  /** As printed ("(1,234.56)"). */
  text: string;
  value: number;
  /** PDF points, bottom-left origin. */
  rect: Rect;
}

/**
 * An amount as accountants print it: "1,234.56", "$1,234", "(1,234.56)" and "1,234.56-"
 * (negative), "-12", ".5", "12%"-free. Null for anything else (dates, words, "1-2").
 */
export function parseAmount(raw: string): number | null {
  // Sentence punctuation after the amount ("... was 1,200.") is not part of it.
  let s = raw.trim().replace(/[:;,.]+$/, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-") || s.endsWith("CR")) {
    neg = !neg;
    s = s.replace(/(-|CR)$/, "");
  }
  if (s.startsWith("-") || s.startsWith("−")) {
    neg = !neg;
    s = s.slice(1);
  }
  s = s.replace(/^\$\s?/, "");
  if (s.startsWith("(") && s.endsWith(")")) {
    neg = !neg;
    s = s.slice(1, -1);
  }
  // Thousands groups must be complete (no "1,23"); a lone number may have no commas.
  if (!/^(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/.test(s) || !/\d/.test(s)) return null;
  const v = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}

/** Characters split into words: same baseline, no space and no wide gap between them. */
export function numberTokens(chars: PageChar[]): PageNumber[] {
  const out: PageNumber[] = [];
  let word: PageChar[] = [];
  const flush = () => {
    const text = word.map((c) => c.ch).join("");
    const value = parseAmount(text);
    if (word.length && value !== null) {
      out.push({
        text,
        value,
        rect: {
          l: Math.min(...word.map((c) => c.l)),
          b: Math.min(...word.map((c) => c.b)),
          r: Math.max(...word.map((c) => c.r)),
          t: Math.max(...word.map((c) => c.t)),
        },
      });
    }
    word = [];
  };
  for (const c of chars) {
    if (/\s/.test(c.ch) || c.generated) {
      flush();
      continue;
    }
    const last = word[word.length - 1];
    if (
      last &&
      (Math.abs(c.y - last.y) > Math.max(1, last.size * 0.3) ||
        c.l - last.r > Math.max(1.5, last.size * 0.3))
    )
      flush();
    word.push(c);
  }
  flush();
  return out;
}

export function pageNumbers(
  m: PdfiumModule,
  bytes: Uint8Array,
  pageIndex: number,
): { height: number; numbers: PageNumber[] } {
  const doc = RawDoc.open(m, bytes);
  try {
    return doc.withPage(pageIndex, (page) => {
      const textPage = m.FPDFText_LoadPage(page);
      try {
        return {
          height: m.FPDF_GetPageHeightF(page),
          numbers: numberTokens(pageChars(m, textPage)),
        };
      } finally {
        m.FPDFText_ClosePage(textPage);
      }
    });
  } finally {
    doc.close();
  }
}
