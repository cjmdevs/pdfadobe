// Text field in fill mode (Phase 6). Replaces @embedpdf/plugin-form's own text renderer,
// which writes to PDFium on every keystroke in parallel tasks: typing fast and pressing
// Tab could save an older value ("Jane Sampl", 1 run in 5 in the trial). This one writes
// once, when the field is left (blur, Enter in a one-line field), so a field edit is also
// one undo step. Esc puts the value back. The field's own PDFium appearance is shown
// while it is not being edited, so comb boxes and fonts look as Acrobat draws them.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PDF_FORM_FIELD_FLAG, type PdfWidgetAnnoObject } from "@embedpdf/models";
import type { AnnotationRendererProps } from "@embedpdf/plugin-annotation/react";
import { useFormCapability } from "@embedpdf/plugin-form/react";
import { trackFormWrite } from "../../app/formWrites";

export function TextFill(props: AnnotationRendererProps) {
  const annotation = props.currentObject as PdfWidgetAnnoObject;
  const { pageIndex, scale, documentId } = props;
  const field = annotation.field;
  const { provides: form } = useFormCapability();
  const scope = form?.forDocument(documentId);
  const readOnly = (field.flag & PDF_FORM_FIELD_FLAG.READONLY) !== 0;
  const multiline = (field.flag & PDF_FORM_FIELD_FLAG.TEXT_MULTIPLINE) !== 0;
  const maxLen = "maxLen" in field ? field.maxLen : undefined;

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(field.value);
  const original = useRef(field.value);
  const cancelled = useRef(false);
  const image = useWidgetImage(annotation, pageIndex, scale, documentId);

  // Commits what the element holds: a blur can arrive before React re-renders with the
  // last keystrokes, so the `text` state may be one render behind.
  const commit = useCallback(
    (value: string) => {
      if (!scope || readOnly || value === original.current) return;
      original.current = value;
      trackFormWrite(scope.setFormFieldValues(pageIndex, annotation, { ...field, value }));
    },
    [annotation, field, pageIndex, readOnly, scope],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      cancelled.current = true;
      setText(original.current);
      e.currentTarget.blur();
    } else if (e.key === "Enter" && !multiline) {
      commit(e.currentTarget.value);
    }
  };

  const common = {
    "data-form-field": field.name,
    "aria-label": field.name,
    className: `form-fill-input${editing ? " editing" : ""}`,
    // While not editing, show the stored value (undo and data import change it).
    value: editing ? text : field.value,
    readOnly,
    maxLength: maxLen || undefined,
    spellCheck: false,
    style: { fontSize: fontPx(annotation, scale, multiline) },
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onFocus: () => {
      original.current = field.value;
      setText(field.value);
      cancelled.current = false;
      setEditing(true);
      scope?.selectField(annotation.id);
    },
    onBlur: (e: { currentTarget: { value: string } }) => {
      setEditing(false);
      if (!cancelled.current) commit(e.currentTarget.value);
      if (scope?.getSelectedFieldId() === annotation.id) scope.deselectField();
    },
    onKeyDown,
  };

  return (
    <div className="form-fill" data-testid="form-text-fill">
      {image && !editing && <img className="form-fill-image" src={image} alt="" />}
      {multiline ? <textarea {...common} /> : <input type="text" {...common} />}
    </div>
  );
}

/** Font size in CSS px: the field's own, or about 70% of the box (auto size 0). */
function fontPx(a: PdfWidgetAnnoObject, scale: number, multiline: boolean): number {
  if (a.fontSize > 0) return a.fontSize * scale;
  return Math.max(8, Math.min(a.rect.size.height * 0.7, multiline ? 12 : 99)) * scale;
}

/** The widget's appearance as PDFium draws it, redrawn when its value changes. */
function useWidgetImage(
  annotation: PdfWidgetAnnoObject,
  pageIndex: number,
  scale: number,
  documentId: string,
): string | null {
  const { provides: form } = useFormCapability();
  const [url, setUrl] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const scope = form?.forDocument(documentId);
    if (!scope) return;
    return scope.onFieldValueChange((e) => {
      if (e.annotationId === annotation.id) setVersion((v) => v + 1);
    });
  }, [annotation.id, documentId, form]);

  useEffect(() => {
    if (!form) return;
    let live = true;
    let made: string | null = null;
    const task = form.renderWidget(
      { pageIndex, annotation, options: { scaleFactor: scale * window.devicePixelRatio } },
      documentId,
    );
    task.wait(
      (blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      },
      () => undefined,
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
    // `annotation` changes identity on every store update; its value is what matters.
  }, [form, pageIndex, scale, documentId, annotation.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  return url;
}
