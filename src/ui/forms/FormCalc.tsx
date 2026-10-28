// Live calculations (Phase 6): when a field changes in the viewer, the calculated fields
// that depend on it are worked out again (engine/forms/calc.ts) and written, formatted,
// like Acrobat does after each change. Custom scripts are never run.
import { useEffect } from "react";
import { PdfAnnotationSubtype, type PdfWidgetAnnoObject } from "@embedpdf/models";
import { useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import { useFormCapability } from "@embedpdf/plugin-form/react";
import { pageOp } from "../../app/pages";
import { trackFormWrite } from "../../app/formWrites";
import { useWorkbench } from "../../app/workbench";
import { displayValue, hasCalcs, recalculate } from "../../engine/forms";
import { calcs } from "./calcStore";

export function FormCalc({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const storeId = wb.meta[documentId]?.storeId;
  const { provides: form } = useFormCapability();
  const { provides: annots } = useAnnotationCapability();

  useEffect(() => {
    let live = true;
    void wb.docBytes(documentId).then(async (bytes) => {
      if (!bytes || !live) return;
      const setup = await pageOp("calcSetup", bytes).catch(() => null);
      if (live) calcs.set(documentId, setup && hasCalcs(setup) ? setup : null);
    });
    return () => {
      live = false;
      calcs.set(documentId, null);
    };
    // Once per document in the store; a new tab id after an edit reads it again.
  }, [storeId, documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!form || !annots) return;
    const scope = form.forDocument(documentId);
    // One recalculation at a time, each reading the values as they are when it runs:
    // the form plugin's writes do not wait for each other, so two rounds in flight could
    // land out of order and leave an older result.
    let queue = Promise.resolve();
    // The latest value of every field: the plugin's own record, plus each changed field's
    // new value from its event (either may lag the other).
    const latest: Record<string, string> = {};
    const run = async (changedName: string) => {
      const setup = calcs.get(documentId);
      if (!setup?.order.length || setup.calcs[changedName]) return;
      const widgets = Object.values(annots.forDocument(documentId).getState().byUid)
        .map((t) => t.object)
        .filter((a): a is PdfWidgetAnnoObject => a.type === PdfAnnotationSubtype.WIDGET);
      const values: Record<string, string> = { ...scope.getFormValues(), ...latest };
      for (const [name, raw] of Object.entries(recalculate(setup, values))) {
        const shown = displayValue(setup, name, raw);
        const w = widgets.find((x) => x.field.name === name);
        if (!w || shown === (latest[name] ?? values[name] ?? "")) continue;
        latest[name] = shown;
        const task = scope.setFormFieldValues(w.pageIndex, w, { ...w.field, value: shown });
        trackFormWrite(task);
        await task.toPromise().catch(() => undefined);
      }
    };
    return scope.onFieldValueChange((e) => {
      const name = e.widget.field.name;
      latest[name] = e.widget.field.value ?? "";
      queue = queue.then(() => run(name)).catch(() => undefined);
      trackFormWrite({ toPromise: () => queue });
    });
  }, [form, annots, documentId]);
  return null;
}
