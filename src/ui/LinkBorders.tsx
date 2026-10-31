// Visible link rectangles. Links are locked (they are click targets, see
// LinkNavigator), and the locked link the annotation plugin draws is transparent; a
// link with a border (/Border or /BS width above 0, as Acrobat draws it) gets that
// border here, in its colour, solid, dashed or underlined.
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  type PdfLinkAnnoObject,
} from "@embedpdf/models";

export function LinkBorders({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const { state } = useAnnotation(documentId);
  const scale = useDocumentState(documentId)?.scale ?? 1;
  const links = (state.pages[pageIndex] ?? [])
    .map((uid) => state.byUid[uid]?.object)
    .filter(
      (a): a is PdfLinkAnnoObject =>
        a?.type === PdfAnnotationSubtype.LINK && (a.strokeWidth ?? 0) > 0,
    );
  if (!links.length) return null;
  return (
    <div className="link-borders" aria-hidden="true">
      {links.map((l) => {
        const w = Math.max(1, (l.strokeWidth ?? 1) * scale);
        const color = l.strokeColor ?? "#000000";
        const underline = l.strokeStyle === PdfAnnotationBorderStyle.UNDERLINE;
        const style = l.strokeStyle === PdfAnnotationBorderStyle.DASHED ? "dashed" : "solid";
        return (
          <div
            key={l.id}
            data-testid="link-border"
            style={{
              position: "absolute",
              left: l.rect.origin.x * scale,
              top: l.rect.origin.y * scale,
              width: l.rect.size.width * scale,
              height: l.rect.size.height * scale,
              boxSizing: "border-box",
              ...(underline
                ? { borderBottom: `${w}px ${style} ${color}` }
                : { border: `${w}px ${style} ${color}` }),
            }}
          />
        );
      })}
    </div>
  );
}
