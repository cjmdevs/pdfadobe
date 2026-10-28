// Prepare Form panel (Phase 6), shown in the Tools pane while Prepare Form is open: the
// buttons that add fields, the group new radio buttons join, and the properties of the
// selected field. Name, required, read-only, multiline and dropdown choices change at
// once in the viewer; max length, default, format and export values are written by the
// engine (Apply, one undoable step).
import { useEffect, useMemo, useState } from "react";
import {
  PDF_FORM_FIELD_FLAG,
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  type PdfWidgetAnnoObject,
} from "@embedpdf/models";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { useFormCapability } from "@embedpdf/plugin-form/react";
import { useWorkbench } from "../../app/workbench";
import {
  DEFAULT_DATE_PATTERN,
  type FieldFormat,
  type FieldProps,
  type NewFieldKind,
} from "../../engine/forms";
import { applyFieldProps, detectAndAdd, loadFieldProps } from "./prepareActions";
import { FIELD_MODE, prepare, usePrepare } from "./prepareStore";
import { useFormFields } from "./useFormFields";

export const ADD_BUTTONS: { kind: NewFieldKind; label: string }[] = [
  { kind: "text", label: "Text" },
  { kind: "checkbox", label: "Check box" },
  { kind: "radio", label: "Radio button" },
  { kind: "dropdown", label: "Dropdown" },
  { kind: "date", label: "Date" },
  { kind: "signature", label: "Signature" },
];

export default function PreparePanel({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const storeKey = wb.meta[documentId]?.storeId ?? documentId;
  const { pending } = usePrepare(documentId);
  const { radioGroup } = usePrepare(storeKey);
  const { provides: im } = useInteractionManager(documentId);
  const arm = (kind: NewFieldKind) => {
    const next = pending === kind ? null : kind;
    prepare.arm(documentId, next);
    // At once, not on the next render: a quick click on the page must already place.
    if (next) im?.activate(FIELD_MODE);
    else im?.activateDefaultMode();
  };
  const fields = useFormFields(documentId);
  const groups = fields.filter((f) => f.type === PDF_FORM_FIELD_TYPE.RADIOBUTTON);
  const { state } = useAnnotation(documentId);
  const selected = useMemo(() => {
    const uid = state.selectedUids.length === 1 ? state.selectedUids[0] : undefined;
    const o = uid ? state.byUid[uid]?.object : undefined;
    return o?.type === PdfAnnotationSubtype.WIDGET ? (o as PdfWidgetAnnoObject) : null;
  }, [state.selectedUids, state.byUid]);

  return (
    <section className="forms-panel" aria-label="Prepare Form" data-testid="prepare-panel">
      <div className="forms-row">
        <button
          type="button"
          disabled={wb.busy !== null}
          title="Find blank lines, underscores and boxes on a flat form and add fields there"
          onClick={() => void detectAndAdd(wb, documentId)}
        >
          Detect fields
        </button>
      </div>
      <h3 className="forms-heading">Add a field</h3>
      <p className="forms-note">Pick a kind, then click on the page. Esc cancels.</p>
      <div className="forms-row">
        {ADD_BUTTONS.map((b) => (
          <button
            key={b.kind}
            type="button"
            aria-pressed={pending === b.kind}
            onClick={() => arm(b.kind)}
          >
            {b.label}
          </button>
        ))}
      </div>
      <label className="forms-field">
        New radio buttons go into
        <select
          value={groups.some((g) => g.name === radioGroup) ? radioGroup : ""}
          onChange={(e) => prepare.setRadioGroup(storeKey, e.target.value)}
        >
          <option value="">a new group</option>
          {groups.map((g) => (
            <option key={g.name} value={g.name}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <h3 className="forms-heading">Selected field</h3>
      {selected ? (
        <FieldProperties key={selected.id} documentId={documentId} widget={selected} />
      ) : (
        <p className="forms-note">Click a field to see its properties.</p>
      )}
    </section>
  );
}

function FieldProperties({
  documentId,
  widget,
}: {
  documentId: string;
  widget: PdfWidgetAnnoObject;
}) {
  const wb = useWorkbench();
  const { provides: scope } = useAnnotation(documentId);
  const { provides: form } = useFormCapability();
  const field = widget.field;
  const [name, setName] = useState(field.name);
  const [props, setProps] = useState<FieldProps | null>(null);
  const [options, setOptions] = useState(
    "options" in field ? field.options.map((o) => o.label).join("\n") : "",
  );
  const isText = field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD;
  const isButton =
    field.type === PDF_FORM_FIELD_TYPE.CHECKBOX || field.type === PDF_FORM_FIELD_TYPE.RADIOBUTTON;
  const isChoice =
    field.type === PDF_FORM_FIELD_TYPE.COMBOBOX || field.type === PDF_FORM_FIELD_TYPE.LISTBOX;
  const isSignature = field.type === PDF_FORM_FIELD_TYPE.SIGNATURE;

  useEffect(() => {
    let live = true;
    void loadFieldProps(wb, documentId, field.name).then((p) => live && setProps(p));
    return () => {
      live = false;
    };
    // Read once per selected field; Apply reloads the tab, which remounts this.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setFlag = (flag: PDF_FORM_FIELD_FLAG, on: boolean) => {
    const next = on ? field.flag | flag : field.flag & ~flag;
    scope?.updateAnnotation(widget.pageIndex, widget.id, {
      field: { ...field, flag: next },
    } as Partial<PdfWidgetAnnoObject>);
  };
  const rename = () => {
    const n = name.trim();
    if (!n || n === field.name || !form) return;
    form
      .forDocument(documentId)
      .renameField(widget.id, n)
      .wait(
        (r) => {
          if (r.outcome === "conflict") {
            wb.toast(`A field named "${n}" already exists. Pick another name.`, "error");
            setName(field.name);
          }
        },
        () => wb.toast("The field could not be renamed.", "error"),
      );
  };
  const saveOptions = () => {
    const list = options
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    scope?.updateAnnotation(widget.pageIndex, widget.id, {
      field: { ...field, options: list.map((label) => ({ label, isSelected: false })) },
    } as Partial<PdfWidgetAnnoObject>);
  };
  const flag = (f: PDF_FORM_FIELD_FLAG) => (field.flag & f) !== 0;

  return (
    <div className="forms-props" data-testid="field-props">
      <label className="forms-field">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === "Enter" && rename()}
        />
      </label>
      {!isSignature && (
        <div className="forms-row">
          <label>
            <input
              type="checkbox"
              checked={flag(PDF_FORM_FIELD_FLAG.REQUIRED)}
              onChange={(e) => setFlag(PDF_FORM_FIELD_FLAG.REQUIRED, e.target.checked)}
            />
            Required
          </label>
          <label>
            <input
              type="checkbox"
              checked={flag(PDF_FORM_FIELD_FLAG.READONLY)}
              onChange={(e) => setFlag(PDF_FORM_FIELD_FLAG.READONLY, e.target.checked)}
            />
            Read-only
          </label>
          {isText && (
            <label>
              <input
                type="checkbox"
                checked={flag(PDF_FORM_FIELD_FLAG.TEXT_MULTIPLINE)}
                onChange={(e) => setFlag(PDF_FORM_FIELD_FLAG.TEXT_MULTIPLINE, e.target.checked)}
              />
              Multiline
            </label>
          )}
        </div>
      )}
      {isChoice && (
        <label className="forms-field">
          Choices (one per line)
          <textarea
            rows={4}
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            onBlur={saveOptions}
          />
        </label>
      )}
      {props && !isSignature && (
        <EngineProps
          key={JSON.stringify(props)}
          initial={props}
          isText={isText}
          isButton={isButton}
          onApply={(p) => void applyFieldProps(wb, documentId, field.name, p)}
        />
      )}
    </div>
  );
}

function EngineProps({
  initial,
  isText,
  isButton,
  onApply,
}: {
  initial: FieldProps;
  isText: boolean;
  isButton: boolean;
  onApply: (p: Partial<FieldProps>) => void;
}) {
  const [maxLen, setMaxLen] = useState(initial.maxLen?.toString() ?? "");
  const [dv, setDv] = useState(initial.defaultValue ?? "");
  const [format, setFormat] = useState<FieldFormat>(initial.format);
  const [exports, setExports] = useState(initial.exportValues.join(", "));

  const apply = () => {
    const p: Partial<FieldProps> = { defaultValue: dv || null };
    if (isText) {
      const n = Number(maxLen);
      p.maxLen = maxLen.trim() && Number.isInteger(n) && n > 0 ? n : null;
      p.format = format;
    }
    if (isButton) p.exportValues = exports.split(",").map((v) => v.trim());
    onApply(p);
  };

  return (
    <div className="forms-props">
      {isText && (
        <label className="forms-field">
          Max length
          <input
            type="number"
            min={1}
            value={maxLen}
            placeholder="no limit"
            onChange={(e) => setMaxLen(e.target.value)}
          />
        </label>
      )}
      <label className="forms-field">
        Default value
        <input type="text" value={dv} onChange={(e) => setDv(e.target.value)} />
      </label>
      {isText && (
        <label className="forms-field">
          Format
          <select
            value={format.kind}
            onChange={(e) =>
              setFormat(
                e.target.value === "number"
                  ? { kind: "number", decimals: 2, sep: 0, negative: 0, currency: "" }
                  : e.target.value === "date"
                    ? { kind: "date", pattern: DEFAULT_DATE_PATTERN }
                    : { kind: "none" },
              )
            }
          >
            <option value="none">None</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
          </select>
        </label>
      )}
      {format.kind === "number" && (
        <div className="forms-row">
          <label className="forms-field">
            Decimals
            <input
              type="number"
              min={0}
              max={10}
              value={format.decimals}
              onChange={(e) =>
                setFormat({ ...format, decimals: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
          <label className="forms-field">
            Currency
            <input
              type="text"
              value={format.currency}
              size={3}
              onChange={(e) => setFormat({ ...format, currency: e.target.value })}
            />
          </label>
          <label className="forms-field">
            Negatives
            <select
              value={format.negative}
              onChange={(e) => setFormat({ ...format, negative: Number(e.target.value) as 0 | 2 })}
            >
              <option value={0}>-1,234.56</option>
              <option value={2}>(1,234.56)</option>
            </select>
          </label>
        </div>
      )}
      {format.kind === "date" && (
        <label className="forms-field">
          Date format
          <select
            value={format.pattern}
            onChange={(e) => setFormat({ kind: "date", pattern: e.target.value })}
          >
            {["mm/dd/yyyy", "m/d/yyyy", "mm/dd/yy", "yyyy-mm-dd", "mmm d, yyyy"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}
      {isButton && (
        <label className="forms-field">
          Export value{initial.exportValues.length > 1 ? "s (one per button, comma-separated)" : ""}
          <input type="text" value={exports} onChange={(e) => setExports(e.target.value)} />
        </label>
      )}
      <div className="forms-row">
        <button type="button" className="primary" onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  );
}
