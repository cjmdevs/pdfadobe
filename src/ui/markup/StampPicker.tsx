// Stamps dialog (Phase 3): built-in text stamps and the user's own images. Picking one
// arms placement: the next click on a page puts it there (StampLayer).
import { useEffect, useState } from "react";
import { useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import { useInteractionManagerCapability } from "@embedpdf/plugin-interaction-manager/react";
import { useWorkbench } from "../../app/workbench";
import { TEXT_STAMPS } from "../../engine/stamps";
import { STAMP_MODE } from "../../markup/config";
import { platform, type CustomStamp } from "../../platform";
import { imageStamp, stampPlacement, textStamp, type PendingStamp } from "./stampPlacement";

/** Last list seen: the dialog opens at its final size (it is centered, so a list that
 * arrives later would move the buttons under the pointer). */
let lastList: CustomStamp[] = [];

export function StampPicker({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const wb = useWorkbench();
  const { provides: annots } = useAnnotationCapability();
  const { provides: im } = useInteractionManagerCapability();
  const [custom, setCustom] = useState<CustomStamp[]>(lastList);
  const author = wb.author;

  const reload = () =>
    platform.stamps
      .list()
      .then((list) => {
        lastList = list;
        setCustom(list);
      })
      .catch(() => setCustom([]));
  useEffect(() => {
    void reload();
  }, []);

  const arm = (s: PendingStamp) => {
    annots?.forDocument(documentId).setActiveTool(null);
    stampPlacement.set(s);
    im?.forDocument(documentId).activate(STAMP_MODE);
    wb.toast(`Click on the page to place the ${s.subject} stamp (Esc cancels).`);
  };
  const fail = (e: unknown) =>
    wb.toast(`Stamp failed: ${e instanceof Error ? e.message : String(e)}`, "error");
  /** Closes at once (a click meant for the page must not land in the dialog). */
  const choose = (make: () => Promise<PendingStamp>) => {
    onClose();
    make().then(arm, fail);
  };

  const addImage = async () => {
    const [file] = await platform.pickFiles({ images: true });
    if (!file) return;
    const name = file.name.replace(/\.[^.]+$/, "");
    try {
      await platform.stamps.add(name, new Uint8Array(file.bytes));
      await reload();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="stamp-picker">
      <h3>Standard</h3>
      <div className="stamp-grid">
        {TEXT_STAMPS.map((d) => (
          <button
            key={d.id}
            type="button"
            className="stamp-choice"
            style={{ color: d.color, borderColor: d.color }}
            onClick={() => choose(() => textStamp(d, author))}
          >
            {d.title}
          </button>
        ))}
      </div>
      <h3>My stamps</h3>
      {custom.length === 0 && <p className="hint">No custom stamps yet.</p>}
      <ul className="stamp-list">
        {custom.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() =>
                choose(() => platform.stamps.read(c.id).then((b) => imageStamp(c.name, b, c.mime)))
              }
            >
              {c.name}
            </button>
            <button
              type="button"
              aria-label={`Remove ${c.name}`}
              title="Remove from my stamps (placed stamps stay)"
              onClick={() => void platform.stamps.remove(c.id).then(reload, fail)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => void addImage()}>
        Add image (PNG or JPEG)…
      </button>
    </div>
  );
}
