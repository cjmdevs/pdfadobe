// The fields of an open tab as the viewer holds them right now (unsaved fills
// included), read from the annotation plugin's widgets: one row per field name.
import { useMemo } from "react";
import {
  PDF_FORM_FIELD_FLAG,
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  type PdfWidgetAnnoObject,
} from "@embedpdf/models";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";

export interface FieldRow {
  name: string;
  type: PDF_FORM_FIELD_TYPE;
  /** First widget: where "go to field" goes. */
  annotationId: string;
  pageIndex: number;
  y: number;
  required: boolean;
  readOnly: boolean;
  empty: boolean;
}

const FILLABLE = new Set([
  PDF_FORM_FIELD_TYPE.TEXTFIELD,
  PDF_FORM_FIELD_TYPE.CHECKBOX,
  PDF_FORM_FIELD_TYPE.RADIOBUTTON,
  PDF_FORM_FIELD_TYPE.COMBOBOX,
  PDF_FORM_FIELD_TYPE.LISTBOX,
]);

const isEmpty = (w: PdfWidgetAnnoObject) => {
  const v = w.field.value ?? "";
  return v === "" || v === "Off";
};

export function useFormFields(documentId: string): FieldRow[] {
  const { state } = useAnnotation(documentId);
  return useMemo(() => {
    const rows = new Map<string, FieldRow>();
    const widgets = Object.values(state.byUid)
      .map((t) => t.object)
      .filter((a): a is PdfWidgetAnnoObject => a.type === PdfAnnotationSubtype.WIDGET)
      .sort((a, b) => a.pageIndex - b.pageIndex || a.rect.origin.y - b.rect.origin.y);
    for (const w of widgets) {
      if (!w.field.name || !FILLABLE.has(w.field.type)) continue;
      const row = rows.get(w.field.name);
      if (row) {
        // A radio group is filled when any of its buttons is on.
        row.empty = row.empty && isEmpty(w);
        continue;
      }
      rows.set(w.field.name, {
        name: w.field.name,
        type: w.field.type,
        annotationId: w.id,
        pageIndex: w.pageIndex,
        y: w.rect.origin.y,
        required: (w.field.flag & PDF_FORM_FIELD_FLAG.REQUIRED) !== 0,
        readOnly: (w.field.flag & PDF_FORM_FIELD_FLAG.READONLY) !== 0,
        empty: isEmpty(w),
      });
    }
    return [...rows.values()];
  }, [state.byUid]);
}
