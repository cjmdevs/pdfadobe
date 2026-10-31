// Registers the form plugin's field renderers with our text field in place of its own
// (see TextFill.tsx), each wrapped in a `.form-widget` box that carries the field name
// and the required flag (field highlighting, tests). The annotation renderer registry
// keeps one entry per id and the last registered wins, so this re-registers whenever
// the plugin's own entry is the one in use.

import { useEffect, useMemo, type ReactElement } from "react";
import {
  PDF_FORM_FIELD_FLAG,
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfWidgetAnnoObject,
} from "@embedpdf/models";
import {
  createRenderer,
  useRegisteredRenderers,
  useRendererRegistry,
  type AnnotationRendererProps,
  type BoxedAnnotationRenderer,
} from "@embedpdf/plugin-annotation/react";
import { formRenderers } from "@embedpdf/plugin-form/react";
import { SignatureBox } from "./SignatureBox";
import { TextFill } from "./TextFill";

const TEXT_ID = "formTextField";

const isSignature = (a: PdfAnnotationObject) =>
  a.type === PdfAnnotationSubtype.WIDGET &&
  (a as PdfWidgetAnnoObject).field?.type === PDF_FORM_FIELD_TYPE.SIGNATURE;
const hasLook = (a: PdfAnnotationObject) => (a.appearanceModes ?? 0) > 0;

/** Signature fields: not covered by the form plugin's renderers. Without a look of
 * their own they are drawn as a labelled box. */
const signatureRenderer = createRenderer<PdfWidgetAnnoObject>({
  id: "formSignature",
  matches: (a): a is PdfWidgetAnnoObject => isSignature(a) && !hasLook(a),
  render: (p) => <SignatureBox props={p} />,
  renderLocked: (p) => <SignatureBox props={p} />,
  interactionDefaults: { isDraggable: true, isResizable: true, isRotatable: false },
  useAppearanceStream: false,
});

/** Signature fields with an appearance (signed ones, Phase 8): their own look, with a
 * see-through box on top for clicks. */
const signatureLookRenderer = createRenderer<PdfWidgetAnnoObject>({
  id: "formSignatureLook",
  matches: (a): a is PdfWidgetAnnoObject => isSignature(a) && hasLook(a),
  render: (p) => <SignatureBox props={p} overlay />,
  renderLocked: (p) => <SignatureBox props={p} overlay />,
  interactionDefaults: { isDraggable: true, isResizable: true, isRotatable: false },
  useAppearanceStream: true,
});

function Widget({ props, children }: { props: AnnotationRendererProps; children: ReactElement }) {
  const field = (props.currentObject as PdfWidgetAnnoObject).field;
  const required = (field.flag & PDF_FORM_FIELD_FLAG.REQUIRED) !== 0;
  return (
    <div className="form-widget" data-field={field.name} data-required={required || undefined}>
      {children}
    </div>
  );
}

export function FormRenderers() {
  const register = useRendererRegistry();
  const current = useRegisteredRenderers();
  const ours = useMemo<BoxedAnnotationRenderer[]>(
    () =>
      formRenderers
        .map((r) => {
          const inner =
            r.id === TEXT_ID ? (p: AnnotationRendererProps) => <TextFill {...p} /> : r.renderLocked;
          if (!inner) return r;
          return {
            ...r,
            renderLocked: (p: AnnotationRendererProps) => <Widget props={p}>{inner(p)}</Widget>,
          };
        })
        .concat(signatureRenderer, signatureLookRenderer),
    [],
  );
  const inUse = current.find((r) => r.id === TEXT_ID)?.renderLocked;
  const mine = ours.find((r) => r.id === TEXT_ID)?.renderLocked;
  useEffect(() => {
    if (register && inUse !== mine) register(ours);
  }, [register, inUse, mine, ours]);
  return null;
}
