// Edit PDF (B3 stage 2): the Objects part of the Edit panel, like Acrobat's. For the
// selection: flip horizontal / vertical, crop, align (two or more objects), rotate,
// replace image, arrange (front, forward, backward, back) and Edit Using (open the
// image in Paint, a program picked from Windows' "Open with", or the default one;
// each save there comes back into the PDF). Buttons that don't apply are greyed out,
// as in Acrobat.
import type { EditImage, EditTextBox } from "../../engine/edit";
import type { Arrange } from "../../engine/edit/arrange";
import { useWorkbench } from "../../app/workbench";
import type { ExternalApp } from "../../platform/types";
import {
  alignSelection,
  arrangeTextBox,
  editUsing,
  imageEdit,
  placeImageEdit,
  replaceImageEdit,
  stopEditUsing,
} from "./editActions";
import { cropping, useCropping, useExternalEdits, type EditSelection } from "./editStore";

const ARRANGE: [Arrange, string][] = [
  ["front", "Bring to front"],
  ["forward", "Bring forward"],
  ["backward", "Send backward"],
  ["back", "Send to back"],
];
const ALIGN = [
  ["left", "Align left"],
  ["center", "Align centres"],
  ["right", "Align right"],
  ["top", "Align top"],
  ["middle", "Align middles"],
  ["bottom", "Align bottom"],
] as const;
const APPS: [ExternalApp, string][] = [
  ["paint", "Paint"],
  ["choose", "Choose a program…"],
  ["default", "Default program"],
];
const APP_NAME: Record<ExternalApp, string> = {
  paint: "Paint",
  choose: "the chosen program",
  default: "the default program",
};

export function ObjectsPanel({
  documentId,
  sel,
  image,
  box,
}: {
  documentId: string;
  sel: EditSelection;
  /** The one selected image, if that is the selection. */
  image?: EditImage | undefined;
  /** The one selected text box, if that is the selection. */
  box?: EditTextBox | undefined;
}) {
  const wb = useWorkbench();
  const crop = useCropping(documentId);
  const storeId = wb.meta[documentId]?.storeId;
  const externals = useExternalEdits(storeId);
  const busy = wb.busy !== null;
  const several = !!sel.more?.length || !!sel.images?.length;
  const upright = !!image && Math.abs(image.placement.rotation) < 0.5;
  const page = sel.page;

  if (crop && image && crop.id === image.id && crop.page === page)
    return (
      <fieldset className="format-box" data-testid="edit-objects">
        <legend>Crop image</legend>
        <p className="small">
          Drag the handles to the part to keep. What is outside is removed from the file.
        </p>
        <div className="format-row">
          <button
            type="button"
            data-testid="crop-apply"
            disabled={busy}
            onClick={() => {
              cropping.set(documentId, null);
              void imageEdit(
                wb,
                documentId,
                page,
                image,
                { kind: "crop", part: crop.part },
                "Crop image",
              );
            }}
          >
            Apply crop
          </button>
          <button type="button" onClick={() => cropping.set(documentId, null)}>
            Cancel
          </button>
        </div>
      </fieldset>
    );

  const button = (
    label: string,
    glyph: string,
    enabled: boolean,
    run: () => void,
    testid?: string,
  ) => (
    <button
      type="button"
      className="format-toggle"
      aria-label={label}
      title={enabled ? label : `${label} (not for this selection)`}
      disabled={busy || !enabled}
      data-testid={testid}
      onClick={run}
    >
      {glyph}
    </button>
  );
  const editing = image
    ? externals.filter(
        (e) =>
          e.page === page && Math.hypot(e.cx - image.placement.cx, e.cy - image.placement.cy) < 1,
      )
    : [];

  return (
    <fieldset className="format-box" data-testid="edit-objects">
      <legend>Objects</legend>
      <div className="format-row" role="group" aria-label="Objects">
        {button("Flip horizontal", "⇋", !!image && !several, () =>
          image
            ? void imageEdit(wb, documentId, page, image, { kind: "flip", axis: "h" }, "Flip image")
            : undefined,
        )}
        {button("Flip vertical", "⇵", !!image && !several, () =>
          image
            ? void imageEdit(wb, documentId, page, image, { kind: "flip", axis: "v" }, "Flip image")
            : undefined,
        )}
        {button(
          upright || !image ? "Crop image" : "Crop image (straighten it first)",
          "⌗",
          upright && !several,
          () =>
            image
              ? cropping.set(documentId, {
                  page,
                  id: image.id,
                  part: { x0: 0, y0: 0, x1: 1, y1: 1 },
                })
              : undefined,
          "edit-crop-start",
        )}
        {button("Rotate left", "⟲", !!image && !several, () =>
          image
            ? void placeImageEdit(
                wb,
                documentId,
                page,
                image,
                { ...image.placement, rotation: image.placement.rotation + 90 },
                "Rotate image",
              )
            : undefined,
        )}
        {button("Rotate right", "⟳", !!image && !several, () =>
          image
            ? void placeImageEdit(
                wb,
                documentId,
                page,
                image,
                { ...image.placement, rotation: image.placement.rotation - 90 },
                "Rotate image",
              )
            : undefined,
        )}
        {button("Replace image…", "⇄", !!image && !several, () =>
          image ? void replaceImageEdit(wb, documentId, page, image) : undefined,
        )}
      </div>
      <div className="format-row">
        <select
          aria-label="Align objects"
          value=""
          disabled={busy || !several}
          title={several ? "Align objects" : "Align objects (Ctrl+click two or more first)"}
          onChange={(e) =>
            void alignSelection(wb, documentId, sel, e.target.value as (typeof ALIGN)[number][0])
          }
        >
          <option value="" disabled>
            Align…
          </option>
          {ALIGN.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Arrange"
          value=""
          disabled={busy || several || (!image && !box)}
          onChange={(e) => {
            const how = e.target.value as Arrange;
            if (image)
              void imageEdit(wb, documentId, page, image, { kind: "arrange", how }, "Arrange");
            else if (box) void arrangeTextBox(wb, documentId, page, box, how);
          }}
        >
          <option value="" disabled>
            Arrange…
          </option>
          {ARRANGE.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="format-row">
        <select
          aria-label="Edit Using"
          value=""
          disabled={busy || !image || several}
          onChange={(e) =>
            image
              ? void editUsing(wb, documentId, page, image, e.target.value as ExternalApp)
              : undefined
          }
        >
          <option value="" disabled>
            Edit Using…
          </option>
          {APPS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {editing.map((e) => (
        <p key={e.id} className="small" data-testid="edit-using-status">
          Open in {APP_NAME[e.app]}: each time you save there, the picture here is updated.{" "}
          <button
            type="button"
            onClick={() => (storeId ? void stopEditUsing(storeId, e.id) : undefined)}
          >
            Stop
          </button>
        </p>
      ))}
    </fieldset>
  );
}
