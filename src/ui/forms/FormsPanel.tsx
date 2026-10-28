// Fill Forms panel (Phase 6), shown in the Tools pane while Fill Forms is open: the
// required-field check, and the list of fields to pick for Clear. Values are not shown
// here (only whether a field is filled), so nothing typed is repeated on screen.
import { useMemo, useRef, useState } from "react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useFormCapability } from "@embedpdf/plugin-form/react";
import { useWorkbench } from "../../app/workbench";
import { looksSensitive, type CsvTable } from "../../engine/forms";
import { clearFields, resetForm } from "./formActions";
import {
  exportFormData,
  fillCopies,
  importFormData,
  pickCsvTable,
  type BatchProgress,
} from "./formDataFiles";
import { useFormFields, type FieldRow } from "./useFormFields";

export default function FormsPanel({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const fields = useFormFields(documentId);
  const { provides: scroll } = useScroll(documentId);
  const { provides: form } = useFormCapability();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(false);
  const [csv, setCsv] = useState<{ name: string; table: CsvTable } | null>(null);
  const [nameColumn, setNameColumn] = useState<string>("");
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const cancel = useRef(false);
  const missing = useMemo(() => fields.filter((f) => f.required && f.empty), [fields]);
  const fieldNames = useMemo(() => new Set(fields.map((f) => f.name)), [fields]);
  const busy = wb.busy !== null;

  const go = (f: FieldRow) => {
    scroll?.scrollToPage({
      pageNumber: f.pageIndex + 1,
      pageCoordinates: { x: 0, y: f.y },
      behavior: "instant",
      alignY: 30,
    });
    form?.forDocument(documentId).selectField(f.annotationId);
  };
  const toggle = (name: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  if (!fields.length) {
    return (
      <section className="forms-panel" aria-label="Fill Forms" data-testid="forms-panel">
        <p className="forms-note">This document has no fillable fields.</p>
      </section>
    );
  }

  const chosen = fields.filter((f) => picked.has(f.name) && !f.readOnly).map((f) => f.name);
  return (
    <section className="forms-panel" aria-label="Fill Forms" data-testid="forms-panel">
      <div className="forms-row">
        <button type="button" onClick={() => setChecked(true)}>
          Check required fields
        </button>
        <button type="button" disabled={busy} onClick={() => void resetForm(wb, documentId)}>
          Reset form
        </button>
      </div>
      {checked && (
        <div className="forms-check" role="status" data-testid="forms-required">
          {missing.length === 0 ? (
            <p>All required fields are filled.</p>
          ) : (
            <>
              <p>
                {missing.length} required field{missing.length === 1 ? " is" : "s are"} empty:
              </p>
              <ul>
                {missing.map((f) => (
                  <li key={f.name}>
                    <button type="button" className="link" onClick={() => go(f)}>
                      {f.name}
                    </button>
                    <span className="forms-page"> p. {f.pageIndex + 1}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <div className="forms-list-head">
        <span>{fields.length} fields</span>
        <button
          type="button"
          className="link"
          onClick={() => setPicked(new Set(fields.map((f) => f.name)))}
        >
          All
        </button>
        <button type="button" className="link" onClick={() => setPicked(new Set())}>
          None
        </button>
      </div>
      <ul className="forms-list" data-testid="forms-list">
        {fields.map((f) => (
          <li key={f.name} className={f.empty ? "empty" : "filled"}>
            <input
              type="checkbox"
              aria-label={`Pick ${f.name}`}
              checked={picked.has(f.name)}
              disabled={f.readOnly}
              onChange={() => toggle(f.name)}
            />
            <button
              type="button"
              className="link"
              title={`Go to ${f.name} (page ${f.pageIndex + 1})`}
              onClick={() => go(f)}
            >
              {f.name}
            </button>
            {f.required && (
              <span className="forms-required" title="Required">
                *
              </span>
            )}
            {f.readOnly && <span className="forms-page">read-only</span>}
          </li>
        ))}
      </ul>
      <div className="forms-row">
        <button
          type="button"
          disabled={busy || !chosen.length}
          onClick={() => void clearFields(wb, documentId, chosen).then(() => setPicked(new Set()))}
        >
          Clear {chosen.length ? `${chosen.length} ` : ""}selected
        </button>
      </div>
      <h3 className="forms-heading">Form data</h3>
      <div className="forms-row">
        <button type="button" disabled={busy} onClick={() => void importFormData(wb, documentId)}>
          Import data…
        </button>
        {(["fdf", "xfdf", "json", "csv"] as const).map((f) => (
          <button
            key={f}
            type="button"
            title={`Export the field values to ${f.toUpperCase()}`}
            onClick={() => void exportFormData(wb, documentId, f)}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>
      <h3 className="forms-heading">Fill copies from a CSV</h3>
      {!csv ? (
        <div className="forms-row">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void pickCsvTable(wb).then((t) => {
                setCsv(t);
                setNameColumn("");
              })
            }
          >
            Choose CSV…
          </button>
        </div>
      ) : (
        <div className="forms-csv" data-testid="forms-csv">
          <p>
            {csv.name}: {csv.table.rows.length} row{csv.table.rows.length === 1 ? "" : "s"},{" "}
            {csv.table.names.filter((n) => fieldNames.has(n)).length} of {csv.table.names.length}{" "}
            columns match fields in this form.
          </p>
          <label>
            Name each file by{" "}
            <select value={nameColumn} onChange={(e) => setNameColumn(e.target.value)}>
              <option value="">row number</option>
              {csv.table.names.map((n, k) => {
                const sensitive = looksSensitive(csv.table.rows.map((r) => r[k] ?? ""));
                return (
                  <option key={n} value={n} disabled={sensitive}>
                    {n}
                    {sensitive ? " (holds SSNs or EINs: not allowed in file names)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
          {progress && progress.done < progress.total ? (
            <div className="forms-row" role="status">
              <span>
                Filling {progress.done + 1} of {progress.total}…
              </span>
              <button type="button" onClick={() => (cancel.current = true)}>
                Stop
              </button>
            </div>
          ) : (
            <div className="forms-row">
              <button
                type="button"
                className="primary"
                disabled={busy || !csv.table.rows.length}
                onClick={() => {
                  cancel.current = false;
                  void fillCopies(
                    wb,
                    documentId,
                    csv.table,
                    nameColumn || null,
                    setProgress,
                    () => cancel.current,
                  ).finally(() => setProgress(null));
                }}
              >
                Fill {csv.table.rows.length} cop{csv.table.rows.length === 1 ? "y" : "ies"}…
              </button>
              <button type="button" onClick={() => setCsv(null)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
