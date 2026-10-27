// Edit PDF (B3) engine: paragraph grouping and re-typesetting on PDFium. Node-safe.

import type { PdfiumModule } from "../pdfium";
import { pageChars, pageRules, type PageChar, type Rules } from "./chars";
import { groupChars, type TextBox } from "./group";

export type { PageChar, Rect, Rules } from "./chars";
export type { Line, Paragraph, TextBox } from "./group";
export { groupChars } from "./group";
export { removeBoxText } from "./split";
export { EditRefused } from "./refusal";

/** Text boxes of a loaded page. Object handles in them are valid while `page` is. */
export function groupPage(
  m: PdfiumModule,
  page: number,
): { boxes: TextBox[]; rules: Rules; chars: PageChar[] } {
  const textPage = m.FPDFText_LoadPage(page);
  if (!textPage) throw new Error("PDFium could not read the page's text");
  try {
    const rules = pageRules(m, page);
    const chars = pageChars(m, textPage);
    return { boxes: groupChars(chars, rules), rules, chars };
  } finally {
    m.FPDFText_ClosePage(textPage);
  }
}
