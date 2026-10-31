// Links over letter/number tickmarks (Phase 4: each goes to the next matching one, so a
// click in Acrobat walks through them) are not drawn as click targets here: they sat
// over their tickmark and took every click, so the tickmark could not be picked or moved
// (owner, B6 check). The link stays in the file for Acrobat; in our app a picked
// tickmark offers "Go to the next C" instead (FlyerOverlay).
import { PdfAnnotationSubtype, type PdfLinkAnnoObject } from "@embedpdf/models";
import { createRenderer, useRegisterRenderers } from "@embedpdf/plugin-annotation/react";
import { pwData } from "../../flyer/items";

const tickLinkRenderer = createRenderer<PdfLinkAnnoObject>({
  id: "workpaperTickLink",
  matches: (a): a is PdfLinkAnnoObject =>
    a.type === PdfAnnotationSubtype.LINK && pwData(a)?.pwType === "TickLink",
  render: () => <></>,
  hiddenWhenLocked: true,
});

export function TickLinkRenderer() {
  useRegisterRenderers([tickLinkRenderer]);
  return null;
}
