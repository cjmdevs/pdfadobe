// Signature fields (Phase 6). The form plugin has no renderer for them, so they were
// invisible and could not be selected. Drawn as a labelled box: in Prepare Form it is
// selected, moved and resized like any field; otherwise it cannot be picked up and says
// to sign in Acrobat (digital signing is not built yet). It decides by the open tool,
// not the annotation lock: the lock goes by the form plugin's tools, which have none for
// signatures.
import type { AnnotationRendererProps } from "@embedpdf/plugin-annotation/react";
import { useWorkbench } from "../../app/workbench";
import { PREPARE_TOOL } from "./prepareStore";

export function SignatureBox({
  props,
}: {
  props: Pick<AnnotationRendererProps, "isSelected" | "scale" | "onClick" | "documentId">;
}) {
  const wb = useWorkbench();
  const { isSelected, scale, onClick, documentId } = props;
  const design = wb.meta[documentId]?.activeTool === PREPARE_TOOL;
  return (
    <div
      className={`signature-box${design && isSelected ? " selected" : ""}${design ? "" : " filling"}`}
      data-testid="signature-box"
      title={design ? "Signature field" : "Signing is not available here yet: sign in Acrobat"}
      onPointerDown={design && !isSelected ? onClick : undefined}
      style={{ fontSize: Math.max(8, 10 * scale) }}
    >
      {design ? "Signature" : "Sign in Acrobat"}
    </div>
  );
}
