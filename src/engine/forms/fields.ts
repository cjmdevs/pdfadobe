// AcroForm fields as the app sees them (Phase 6), read through EmbedPDF's PDFium engine:
// one entry per fully qualified field name, with every widget that shows it. Values are
// document data: never log them. Node-safe.

import {
  PDF_FORM_FIELD_FLAG,
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfWidgetAnnoObject,
} from "@embedpdf/models";
import type { Engine } from "../pdfium";

export type FieldKind =
  "text" | "checkbox" | "radio" | "dropdown" | "list" | "signature" | "button" | "unknown";

export interface FieldWidget {
  /** Widget annotation id (/NM, assigned by EmbedPDF when missing). */
  id: string;
  pageIndex: number;
  /** For checkboxes and radio buttons: the "on" appearance state name of this widget. */
  exportValue?: string;
  /** What the user sees and data files carry: /Opt entry when the field has one, else exportValue. */
  label?: string;
}

export interface FormField {
  name: string;
  kind: FieldKind;
  /** Text, chosen option, or a button's label ("Off" when not set). */
  value: string;
  /** Dropdown/list options; radio and checkbox labels, one per distinct on-state. */
  options: string[];
  required: boolean;
  readOnly: boolean;
  multiline: boolean;
  maxLen?: number;
  widgets: FieldWidget[];
}

const KIND: Partial<Record<PDF_FORM_FIELD_TYPE, FieldKind>> = {
  [PDF_FORM_FIELD_TYPE.TEXTFIELD]: "text",
  [PDF_FORM_FIELD_TYPE.CHECKBOX]: "checkbox",
  [PDF_FORM_FIELD_TYPE.RADIOBUTTON]: "radio",
  [PDF_FORM_FIELD_TYPE.COMBOBOX]: "dropdown",
  [PDF_FORM_FIELD_TYPE.LISTBOX]: "list",
  [PDF_FORM_FIELD_TYPE.SIGNATURE]: "signature",
  [PDF_FORM_FIELD_TYPE.PUSHBUTTON]: "button",
};

export const kindOf = (w: PdfWidgetAnnoObject): FieldKind => KIND[w.field.type] ?? "unknown";

const has = (flags: number, f: PDF_FORM_FIELD_FLAG) => (flags & f) !== 0;

export async function pageWidgets(
  engine: Engine,
  doc: PdfDocumentObject,
  pageIndex: number,
): Promise<PdfWidgetAnnoObject[]> {
  const page = doc.pages[pageIndex];
  if (!page) return [];
  const all: PdfAnnotationObject[] = await engine.getPageAnnotations(doc, page).toPromise();
  return all.filter((a): a is PdfWidgetAnnoObject => a.type === PdfAnnotationSubtype.WIDGET);
}

/** Every field of an open document, in page then widget order (the default tab order). */
export async function readFields(engine: Engine, doc: PdfDocumentObject): Promise<FormField[]> {
  const byName = new Map<string, FormField>();
  for (let p = 0; p < doc.pages.length; p++) {
    for (const w of await pageWidgets(engine, doc, p)) {
      const name = w.field.name;
      if (!name) continue;
      const kind = kindOf(w);
      let f = byName.get(name);
      if (!f) {
        const flags = w.field.flag;
        f = {
          name,
          kind,
          value: w.field.value ?? "",
          options: [],
          required: has(flags, PDF_FORM_FIELD_FLAG.REQUIRED),
          readOnly: has(flags, PDF_FORM_FIELD_FLAG.READONLY),
          multiline: kind === "text" && has(flags, PDF_FORM_FIELD_FLAG.TEXT_MULTIPLINE),
          widgets: [],
        };
        if (w.field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD && w.field.maxLen)
          f.maxLen = w.field.maxLen;
        if ("options" in w.field && (kind === "dropdown" || kind === "list"))
          f.options = w.field.options.map((o) => o.label);
        byName.set(name, f);
      }
      const widget: FieldWidget = { id: w.id, pageIndex: p };
      if ((kind === "checkbox" || kind === "radio") && w.exportValue) {
        // Buttons with /Opt (pdf-lib, some Acrobat forms) name their states "0", "1"...
        // and keep the real export values in /Opt, one per widget in /Kids order.
        const opt = "options" in w.field ? w.field.options[f.widgets.length]?.label : undefined;
        widget.exportValue = w.exportValue;
        widget.label = opt || w.exportValue;
        if (!f.options.includes(widget.label)) f.options.push(widget.label);
      }
      f.widgets.push(widget);
    }
  }
  for (const f of byName.values()) {
    if (f.kind !== "checkbox" && f.kind !== "radio") continue;
    const on = f.widgets.find((w) => w.exportValue === f.value);
    f.value = on?.label ?? (f.value && f.value !== "Off" ? f.value : "Off");
  }
  return [...byName.values()];
}

/** Required fields that are still empty (a button left "Off" counts as empty). */
export function missingRequired(fields: FormField[]): string[] {
  return fields
    .filter((f) => f.required && (f.value === "" || f.value === "Off"))
    .map((f) => f.name);
}
