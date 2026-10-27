// Per document (Phase 4): the floating tickmark palette, number keys 1-9 to switch the
// armed tickmark, and the Stamp Summary rows for the CSV export.
import { useEffect, useMemo, useRef } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useWorkbench } from "../../app/workbench";
import { summaryRows } from "../../flyer/items";
import { useDocToolContext } from "../../tools/useToolContext";
import { summarySources } from "./flyerFiles";
import { TickmarkIcon } from "./TickmarkIcon";

export function FlyerOverlay({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const { state } = useAnnotation(documentId);
  const flyer = useDocToolContext(documentId).flyer;
  const rows = useMemo(
    () => summaryRows(Object.values(state.byUid).map((t) => t.object)),
    [state.byUid],
  );
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });
  useEffect(() => {
    summarySources.set(documentId, () => rowsRef.current);
    return () => void summarySources.delete(documentId);
  }, [documentId]);

  // While placing: 1-9 pick the n-th tickmark of the library (as numbered in the palette).
  const latest = useRef(flyer);
  useEffect(() => {
    latest.current = flyer;
  });
  const placing = flyer?.placing ?? false;
  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      if (e.ctrlKey || e.altKey || e.metaKey || !/^[1-9]$/.test(e.key)) return;
      const f = latest.current;
      const def = f?.library[Number(e.key) - 1]?.def;
      if (!f || !def) return;
      e.preventDefault();
      f.arm(def.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

  if (!wb.settings.tickmarkPaletteOpen || !flyer) return null;
  return (
    <div className="tick-palette" role="toolbar" aria-label="Tickmark palette">
      <header>
        <span>Tickmarks</span>
        <button
          type="button"
          className="tool"
          aria-label="Close the palette"
          onClick={() => wb.updateSettings({ tickmarkPaletteOpen: false })}
        >
          ×
        </button>
      </header>
      <div className="tick-grid">
        {flyer.library.map((e, i) => (
          <button
            key={e.def.id}
            type="button"
            title={`${e.def.name}${i < 9 ? ` (key ${i + 1})` : ""}`}
            aria-label={e.def.name}
            aria-pressed={flyer.placing && flyer.active?.id === e.def.id}
            onClick={() =>
              flyer.placing && flyer.active?.id === e.def.id ? flyer.stop() : flyer.arm(e.def.id)
            }
          >
            <TickmarkIcon def={e.def} size={16} />
            {i < 9 && <small>{i + 1}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}
