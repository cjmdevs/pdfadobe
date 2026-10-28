// Text field in fill mode (Phase 6). Replaces @embedpdf/plugin-form's own text renderer,
// which writes to PDFium on every keystroke in parallel tasks: typing fast and pressing
// Tab could save an older value ("Jane Sampl", 1 run in 5 in the trial). This one writes
// once, when the field is left (blur, Enter in a one-line field), so a field edit is also
// one undo step. Esc puts the value back. The field's own PDFium appearance is shown
// while it is not being edited, so comb boxes and fonts look as Acrobat draws them.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PDF_FORM_FIELD_FLAG, type PdfWidgetAnnoObject } from "@embedpdf/models";
import type { AnnotationRendererProps } from "@embedpdf/plugin-annotation/react";
import { useFormCapability, useFormDocumentState } from "@embedpdf/plugin-form/react";
import { trackFormWrite } from "../../app/formWrites";
import { displayValue } from "../../engine/forms";
import { calcs } from "./calcStore";

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
  // Typed into since focus: until then a focused field still follows its stored value
  // (a calculation can change it while the cursor is in it, e.g. after Tab).
  const [dirty, setDirty] = useState(false);
  const original = useRef(field.value);
  const cancelled = useRef(false);
  const { url: image, value: changedTo } = useWidgetImage(annotation, pageIndex, scale, documentId);
  // The value to show: the plugin's latest change event wins over the annotation state,
  // which can miss a quick run of updates (live calculations write several in a row).
  const stored = changedTo ?? field.value;
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // Selected from elsewhere (the Forms panel, the plugin's next/previous field): focus.
  const selected = useFormDocumentState(documentId).selectedFieldId === annotation.id;
  useEffect(() => {
    if (selected && document.activeElement !== inputRef.current) inputRef.current?.focus();
  }, [selected]);

  // Commits what the element holds: a blur can arrive before React re-renders with the
  // last keystrokes, so the `text` state may be one render behind.
  const commit = useCallback(
    (typed: string) => {
      // Number fields show their format ("$1,234.50") once left, like Acrobat.
      const setup = calcs.get(documentId);
      const value = setup ? displayValue(setup, field.name, typed, maxLen) : typed;
      if (!scope || readOnly || value === original.current) return;
      original.current = value;
      trackFormWrite(scope.setFormFieldValues(pageIndex, annotation, { ...field, value }));
    },
    [annotation, documentId, field, maxLen, pageIndex, readOnly, scope],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      cancelled.current = true;
      setText(original.current);
      e.currentTarget.blur();
    } else if (e.key === "Enter" && !multiline && dirty) {
      commit(e.currentTarget.value);
      setDirty(false);
    }
  };

  const common = {
    ref: inputRef,
    "data-form-field": field.name,
    "aria-label": field.name,
    className: `form-fill-input${editing ? " editing" : ""}`,
    // While not editing, show the stored value (undo and data import change it).
    value: editing && dirty ? text : stored,
    readOnly,
    maxLength: maxLen || undefined,
    spellCheck: false,
    style: { fontSize: fontPx(annotation, scale, multiline) },
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      setDirty(true);
    },
    onFocus: () => {
      original.current = stored;
      setText(stored);
      setDirty(false);
      cancelled.current = false;
      setEditing(true);
      scope?.selectField(annotation.id);
    },
    onBlur: (e: { currentTarget: { value: string } }) => {
      setEditing(false);
      if (!cancelled.current && dirty) commit(e.currentTarget.value);
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
): { url: string | null; value: string | null } {
  const { provides: form } = useFormCapability();
  const [url, setUrl] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // Start from the plugin's record (this component may mount after the last change).
  const [value, setValue] = useState<string | null>(() => {
    const v = form?.forDocument(documentId).getFormValues()[annotation.field.name];
    return v === undefined ? null : v;
  });

  useEffect(() => {
    const scope = form?.forDocument(documentId);
    if (!scope) return;
    return scope.onFieldValueChange((e) => {
      if (e.annotationId !== annotation.id) return;
      setVersion((v) => v + 1);
      setValue(e.widget.field.value ?? "");
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

  return { url, value };
}
