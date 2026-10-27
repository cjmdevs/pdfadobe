// Before a sign-off stamp is placed (Phase 4 stage 2): its workpaper reference and custom
// fields. Name, initials and time are filled in at each click.
import { useState } from "react";
import { useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import { useInteractionManagerCapability } from "@embedpdf/plugin-interaction-manager/react";
import { useWorkbench } from "../../app/workbench";
import { mergeStamps } from "../../flyer/library";
import { armStamp } from "./useFlyer";

/** The last reference typed: the next stamp usually goes on the same workpaper. */
const lastRef = new Map<"ref", string>();

export function StampDetails({
  documentId,
  templateId,
  onClose,
}: {
  documentId: string;
  templateId: string;
  onClose: () => void;
}) {
  const wb = useWorkbench();
  const { provides: annots } = useAnnotationCapability();
  const { provides: im } = useInteractionManagerCapability();
  const t = mergeStamps(wb.settings.firmStampsCache ?? [], wb.settings.stampTemplates).find(
    (e) => e.def.id === templateId,
  )?.def;
  const [ref, setRef] = useState(lastRef.get("ref") ?? "");
  const [fields, setFields] = useState<Record<string, string>>({});
  if (!t) return <p>This stamp is no longer in the library.</p>;
  const place = () => {
    lastRef.set("ref", ref);
    onClose();
    void armStamp(
      wb,
      annots?.forDocument(documentId),
      im?.forDocument(documentId) ?? null,
      t,
      ref.trim(),
      fields,
    );
  };
  return (
    <form
      className="stamp-details"
      onSubmit={(e) => {
        e.preventDefault();
        place();
      }}
    >
      {t.kind === "status" && t.showRef && (
        <label>
          W/P reference{" "}
          <input autoFocus value={ref} maxLength={30} onChange={(e) => setRef(e.target.value)} />
        </label>
      )}
      {t.fields.map((f) => (
        <label key={f}>
          {f}{" "}
          <input
            value={fields[f] ?? ""}
            maxLength={60}
            onChange={(e) => setFields({ ...fields, [f]: e.target.value })}
          />
        </label>
      ))}
      <p className="hint">
        Signed {wb.author}
        {wb.settings.userInitials ? ` (${wb.settings.userInitials})` : ""}, with the time of each
        click.
      </p>
      <button type="submit" className="primary">
        Place
      </button>
    </form>
  );
}
