// Edit PDF (B3) engine: paragraph grouping and re-typesetting on PDFium. Node-safe.

import type { PdfiumModule } from "../pdfium";
import { pageChars, pageRules, type PageChar, type Rules } from "./chars";
import { groupChars, type TextBox } from "./group";

export type { PageChar, Rect, Rules } from "./chars";
export type { Line, Paragraph, TextBox } from "./group";
export { groupChars } from "./group";
export { removeBoxText } from "./split";
export { applySpacing } from "./spacing";
export { createKerner, type Kerner } from "./fonts/kern";
export { EditRefused } from "./refusal";
export { retypeset, detectStyle, findOverflow, underlinesOf } from "./retypeset";
export type {
  CharRun,
  CharStyle,
  EditParagraph,
  EditTarget,
  FontChoice,
  Overflow,
  ParagraphStyle,
  RetypesetDeps,
  RetypesetResult,
  Rgba,
  WrittenFont,
} from "./retypeset";
export { layoutParagraph, wrapWords, type Align } from "./typeset";
export {
  addImage,
  deleteImage,
  imageFileSize,
  matrixToPlacement,
  pageImages,
  placeImage,
  placementToMatrix,
  replaceImage,
  type PageImage,
  type Placement,
} from "./images";

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

export { editPageInfo, hitTest } from "./pageInfo";
export type { EditImage, EditPageInfo, EditTextBox, PlainParagraphStyle } from "./pageInfo";
export type { DetectedRun } from "./retypeset";
export {
  addImageToPage,
  addTextBox,
  editBoxText,
  editImage,
  joinBoxes,
  moveBox,
  alignObjects,
  arrangeBox,
  exportImage,
  splitBox,
} from "./document";
export type {
  AlignHow,
  AlignItem,
  BoxRef,
  Caret,
  EditOutcome,
  ImageEdit,
  ImageRef,
  PlainFont,
  PlainCharStyle,
  PlainStyle,
  RichText,
} from "./document";
