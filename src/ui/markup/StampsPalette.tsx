// Stamps Palette (B6, like Acrobat's): a floating window with a category list and the
// stamps of that category as pictures; a click arms the stamp for the next click on a page.
import { useState } from "react";
import { useWorkbench } from "../../app/workbench";
import { useDocToolContext } from "../../tools/useToolContext";
import { StampChip } from "../Toolbar";
import { allStamps, stampCategories, useStampLibraryVersion } from "./stampLibrary";

const FAVORITES = "Favorites";

export function StampsPalette({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const ctx = useDocToolContext(documentId);
  useStampLibraryVersion();
  const entries = allStamps(wb);
  const cats = [FAVORITES, ...stampCategories(entries)];
  const [cat, setCat] = useState(() => (wb.settings.stampFavorites.length ? FAVORITES : cats[1]));
  const shown =
    cat === FAVORITES
      ? wb.settings.stampFavorites.flatMap((r) => entries.filter((e) => e.ref === r))
      : entries.filter((e) => e.category === cat);
  return (
    <div className="stamps-palette" role="dialog" aria-label="Stamps Palette">
      <header>
        <select aria-label="Stamp category" value={cat} onChange={(e) => setCat(e.target.value)}>
          {cats.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button
          type="button"
          className="tool"
          aria-label="Close the Stamps Palette"
          onClick={() => wb.updateSettings({ stampsPaletteOpen: false })}
        >
          ×
        </button>
      </header>
      <div className="stamps-grid">
        {shown.map((e) => (
          <button
            key={e.ref}
            type="button"
            aria-label={e.name}
            title={e.name}
            aria-pressed={wb.settings.lastStamp === e.ref}
            onClick={() => ctx.markup?.pickStamp(e.ref)}
          >
            {wb.settings.showStampNames ? e.name : <StampChip preview={e.preview} />}
          </button>
        ))}
        {shown.length === 0 && (
          <p className="hint">
            {cat === FAVORITES
              ? "No favorites yet: place a stamp, then Stamp ▸ Add Current Stamp To Favorites."
              : "No stamps here."}
          </p>
        )}
      </div>
    </div>
  );
}
