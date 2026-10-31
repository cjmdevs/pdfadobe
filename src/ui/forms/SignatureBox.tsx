// Signature fields (Phase 6, signing since Phase 8). The form plugin has no renderer for
// them. A field without a look of its own is drawn as a labelled box; one with a look
// (a signed field) shows it, with a see-through box on top (`overlay`). In Prepare Form
// the box is selected, moved and resized like any field; otherwise a click on an empty
// field signs it with a certificate, and a click on a signed one opens the Signatures
// panel. It decides by the open tool, not the annotation lock: the lock goes by the
// form plugin's tools, which have none for signatures.
import type { AnnotationRendererProps } from "@embedpdf/plugin-annotation/react";
import type { PdfWidgetAnnoObject } from "@embedpdf/models";
import { useWorkbench } from "../../app/workbench";
import { PREPARE_TOOL } from "./prepareStore";

export function SignatureBox({
  props,
  overlay = false,
}: {
  props: Pick<
    AnnotationRendererProps,
    "isSelected" | "scale" | "onClick" | "documentId" | "currentObject"
  >;
  overlay?: boolean;
}) {
  const wb = useWorkbench();
  const { isSelected, scale, onClick, documentId, currentObject } = props;
  const design = wb.meta[documentId]?.activeTool === PREPARE_TOOL;
  const name = (currentObject as PdfWidgetAnnoObject).field?.name ?? "";
  const sign = () =>
    void import("../sign/signActions").then((m) => m.clickSignatureField(wb, documentId, name));
  return (
    <div
      className={`signature-box${design && isSelected ? " selected" : ""}${design ? "" : " filling"}${overlay ? " overlay" : ""}`}
      data-testid="signature-box"
      title={
        design ? "Signature field" : overlay ? "Signature: click for details" : "Click to sign"
      }
      onPointerDown={design ? (!isSelected ? onClick : undefined) : sign}
      style={{ fontSize: Math.max(8, 10 * scale) }}
    >
      {overlay ? null : design ? "Signature" : "Click to sign"}
    </div>
  );
}
