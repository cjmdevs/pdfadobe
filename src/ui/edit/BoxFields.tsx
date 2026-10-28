// Edit PDF (B3 stage 2): the Edit panel's position and size fields, like Acrobat's
// Edit object properties. Inches from the page's top-left corner (2 decimals).
//
// Text box: X, Y, W, H of its frame (a new X/Y moves the text as it is, a new W wraps
// it again, a new H fixes the height and turns auto-fit off), auto-fit height,
// padding, and whether growing text pushes the boxes below down. Image: X, Y, W, H
// (with the proportions locked, W and H change together).
import type { EditImage, EditTextBox, Placement } from "../../engine/edit";
import { useWorkbench } from "../../app/workbench";
import { applyFrame, placeImageEdit } from "./editActions";
import { editOptions, frameSettings, useEditOptions, useFramesVersion } from "./editStore";
import { frameOf, fromInches, overfull, toInches } from "./frame";
import { NumberField } from "./NumberField";

const INCH = { min: -100, max: 100, step: 0.01 };

export function TextBoxFields({
  documentId,
  page,
  pageHeight,
  box,
  disabled,
}: {
  documentId: string;
  page: number;
  pageHeight: number;
  box: EditTextBox;
  disabled: boolean;
}) {
  const wb = useWorkbench();
  useFramesVersion();
  const storeId = wb.meta[documentId]?.storeId;
  const f = frameSettings.get(storeId, page, box);
  const frame = frameOf(box, f);
  const set = (next: typeof frame) => void applyFrame(wb, documentId, page, box, next);
  const x = frame.l;
  const y = pageHeight - frame.t;
  const w = frame.r - frame.l;
  const h = frame.t - frame.b;
  return (
    <fieldset className="format-box" data-testid="edit-box-fields">
      <legend>Text box (inches)</legend>
      <div className="format-row format-grid">
        <label>
          <span>X</span>
          <NumberField
            label="X position"
            value={toInches(x)}
            {...INCH}
            disabled={disabled}
            onCommit={(v) => set({ ...frame, l: fromInches(v), r: fromInches(v) + w })}
          />
        </label>
        <label>
          <span>Y</span>
          <NumberField
            label="Y position"
            value={toInches(y)}
            {...INCH}
            disabled={disabled}
            onCommit={(v) => {
              const t = pageHeight - fromInches(v);
              set({ ...frame, t, b: t - h });
            }}
          />
        </label>
        <label>
          <span>W</span>
          <NumberField
            label="Width"
            value={toInches(w)}
            {...INCH}
            min={0.2}
            disabled={disabled}
            onCommit={(v) => set({ ...frame, r: frame.l + fromInches(v) })}
          />
        </label>
        <label>
          <span>H</span>
          <NumberField
            label="Height"
            value={toInches(h)}
            {...INCH}
            min={0.1}
            disabled={disabled}
            onCommit={(v) => set({ ...frame, b: frame.t - fromInches(v) })}
          />
        </label>
      </div>
      <label className="format-row format-check">
        <input
          type="checkbox"
          data-testid="edit-autofit"
          checked={f.autoFit}
          disabled={disabled}
          onChange={(e) =>
            frameSettings.set(storeId, page, box, {
              autoFit: e.target.checked,
              height: e.target.checked ? null : h,
            })
          }
        />
        <span>Auto-fit height to text</span>
      </label>
      <label className="format-row">
        <span>Padding (pt)</span>
        <NumberField
          label="Padding"
          value={f.padding}
          min={0}
          max={72}
          step={0.5}
          disabled={disabled}
          onCommit={(padding) => frameSettings.set(storeId, page, box, { padding })}
        />
      </label>
      {overfull(box, f) && (
        <p className="format-overflow" role="alert" data-testid="overfull-note">
          The text is taller than the box. Make the box taller, turn on auto-fit, or shorten the
          text.
        </p>
      )}
      <PushOption />
      <p className="small muted">
        Drag the box to move it (arrow keys: 1 pt, Shift: 10 pt). The handles resize it: the sides
        wrap the text again, the bottom sets a fixed height.
      </p>
    </fieldset>
  );
}

/** "Push text below down": what an edit does when the text grows into content below. */
export function PushOption() {
  const { push } = useEditOptions();
  return (
    <label className="format-row format-check">
      <input
        type="checkbox"
        data-testid="edit-push"
        checked={push}
        onChange={(e) => editOptions.set({ push: e.target.checked })}
      />
      <span>When text grows, push the text below down</span>
    </label>
  );
}

export function ImageFields({
  documentId,
  page,
  pageHeight,
  image,
  disabled,
}: {
  documentId: string;
  page: number;
  pageHeight: number;
  image: EditImage;
  disabled: boolean;
}) {
  const wb = useWorkbench();
  const { lockAspect } = useEditOptions();
  const p = image.placement;
  const x = p.cx - p.width / 2;
  const top = p.cy + p.height / 2;
  const place = (next: Placement) =>
    void placeImageEdit(wb, documentId, page, image, next, "Resize image");
  const move = (next: Placement) =>
    void placeImageEdit(wb, documentId, page, image, next, "Move image");
  const size = (width: number, height: number) =>
    // The top-left corner stays put.
    place({ ...p, width, height, cx: x + width / 2, cy: top - height / 2 });
  return (
    <fieldset className="format-box" data-testid="edit-image-fields">
      <legend>Image (inches)</legend>
      <div className="format-row format-grid">
        <label>
          <span>X</span>
          <NumberField
            label="X position"
            value={toInches(x)}
            {...INCH}
            disabled={disabled}
            onCommit={(v) => move({ ...p, cx: fromInches(v) + p.width / 2 })}
          />
        </label>
        <label>
          <span>Y</span>
          <NumberField
            label="Y position"
            value={toInches(pageHeight - top)}
            {...INCH}
            disabled={disabled}
            onCommit={(v) => move({ ...p, cy: pageHeight - fromInches(v) - p.height / 2 })}
          />
        </label>
        <label>
          <span>W</span>
          <NumberField
            label="Width"
            value={toInches(p.width)}
            {...INCH}
            min={0.05}
            disabled={disabled}
            onCommit={(v) => {
              const width = fromInches(v);
              size(width, lockAspect ? (p.height * width) / p.width : p.height);
            }}
          />
        </label>
        <label>
          <span>H</span>
          <NumberField
            label="Height"
            value={toInches(p.height)}
            {...INCH}
            min={0.05}
            disabled={disabled}
            onCommit={(v) => {
              const height = fromInches(v);
              size(lockAspect ? (p.width * height) / p.height : p.width, height);
            }}
          />
        </label>
      </div>
      <label className="format-row format-check">
        <input
          type="checkbox"
          data-testid="edit-lock-aspect"
          checked={lockAspect}
          onChange={(e) => editOptions.set({ lockAspect: e.target.checked })}
        />
        <span>Lock aspect ratio (Shift while dragging a corner does the other)</span>
      </label>
    </fieldset>
  );
}
