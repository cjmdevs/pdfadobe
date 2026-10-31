// Custom Stamps (Phase 3 image stamps; Acrobat's Create and Manage since B6): make a stamp
// from a PNG or JPEG file (or the clipboard's picture) with a name and a category, and
// rename, recategorise or delete the user's stamps. Stamps already placed stay as they are.
import { useState } from "react";
import { useWorkbench } from "../../app/workbench";
import { platform } from "../../platform";
import { StampChip } from "../Toolbar";
import {
  DEFAULT_CATEGORY,
  allStamps,
  reloadStamps,
  stampCategories,
  useStampLibraryVersion,
} from "./stampLibrary";
import { clipboardImage } from "./stampPlacement";

export function StampPicker() {
  const wb = useWorkbench();
  useStampLibraryVersion();
  const mine = allStamps(wb).filter((e) => e.custom);
  const cats = stampCategories(mine);
  const [name, setName] = useState("");
  const [category, setCategory] = useState(cats[0] ?? DEFAULT_CATEGORY);
  const [busy, setBusy] = useState(false);

  const setInfo = (id: string, patch: { category?: string; name?: string }) => {
    const info = wb.settings.customStampInfo;
    const cur = info[id] ?? { category: DEFAULT_CATEGORY };
    wb.updateSettings({ customStampInfo: { ...info, [id]: { ...cur, ...patch } } });
  };
  const fail = (e: unknown) =>
    wb.toast(`Stamp failed: ${e instanceof Error ? e.message : String(e)}`, "error");

  const create = async (bytes: Uint8Array, fallback: string) => {
    const stampName = name.trim() || fallback;
    const made = await platform.stamps.add(stampName, bytes);
    setInfo(made.id, { category: category.trim() || DEFAULT_CATEGORY });
    await reloadStamps();
    setName("");
    wb.toast(`Stamp "${stampName}" added to ${category.trim() || DEFAULT_CATEGORY}.`);
  };
  const fromFile = async () => {
    const [file] = await platform.pickFiles({ images: true });
    if (!file) return;
    setBusy(true);
    await create(new Uint8Array(file.bytes), file.name.replace(/\.[^.]+$/, "")).catch(fail);
    setBusy(false);
  };
  const fromClipboard = async () => {
    setBusy(true);
    try {
      const img = await clipboardImage();
      if (img) await create(img.bytes, "Pasted image");
      else wb.toast("There is no picture on the clipboard.", "error");
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  };

  return (
    <div className="stamp-manager">
      <h3>Create Custom Stamp</h3>
      <label className="field-row">
        Name
        <input
          value={name}
          maxLength={60}
          placeholder="From the file name"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field-row">
        Category
        <input
          value={category}
          maxLength={60}
          list="stamp-categories"
          onChange={(e) => setCategory(e.target.value)}
        />
        <datalist id="stamp-categories">
          {cats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <div className="button-row inline">
        <button type="button" disabled={busy} onClick={() => void fromFile()}>
          Choose image (PNG or JPEG)…
        </button>
        <button type="button" disabled={busy} onClick={() => void fromClipboard()}>
          Use the clipboard's picture
        </button>
      </div>
      <h3>Manage Stamps</h3>
      {mine.length === 0 && <p className="hint">No custom stamps yet.</p>}
      <ul className="stamp-list">
        {mine.map((e) => {
          const id = e.custom?.id ?? "";
          return (
            <li key={e.ref}>
              <StampChip preview={e.preview} />
              <input
                aria-label={`Name of ${e.name}`}
                defaultValue={e.name}
                maxLength={60}
                onBlur={(ev) => {
                  const v = ev.target.value.trim();
                  if (v && v !== e.name) setInfo(id, { name: v, category: e.category });
                }}
              />
              <input
                aria-label={`Category of ${e.name}`}
                defaultValue={e.category}
                maxLength={60}
                list="stamp-categories"
                onBlur={(ev) => {
                  const v = ev.target.value.trim();
                  if (v && v !== e.category) setInfo(id, { category: v });
                }}
              />
              <button
                type="button"
                aria-label={`Delete ${e.name}`}
                title="Delete this stamp (placed stamps stay)"
                onClick={() =>
                  void platform.stamps
                    .remove(id)
                    .then(() => {
                      const rest = Object.fromEntries(
                        Object.entries(wb.settings.customStampInfo).filter(([k]) => k !== id),
                      );
                      wb.updateSettings({
                        customStampInfo: rest,
                        stampFavorites: wb.settings.stampFavorites.filter((r) => r !== e.ref),
                      });
                      return reloadStamps();
                    })
                    .catch(fail)
                }
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
