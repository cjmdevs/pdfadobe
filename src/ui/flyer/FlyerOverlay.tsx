// Per document (Phase 4): the floating tickmark palette, number keys 1-9 to switch the
// armed tickmark, the Stamp Summary rows for the CSV export, connectors kept attached to
// what they point at, and "go to the other end" for a selected cross-page connector.
import { useEffect, useMemo, useRef } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { reroutes } from "../../flyer/connectors";
import { pwData } from "../../flyer/items";
import { useWorkbench } from "../../app/workbench";
import { summaryRows } from "../../flyer/items";
import { useDocToolContext } from "../../tools/useToolContext";
import { summarySources } from "./flyerFiles";
import { TickmarkIcon } from "./TickmarkIcon";
import { CalculatorPanel } from "./CalculatorPanel";
import { calcStore } from "./calcStore";
import { EMPTY_CALC, type TapeLine } from "../../flyer/calc";

export function FlyerOverlay({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const { provides: scope, state } = useAnnotation(documentId);
  const { provides: scroll } = useScroll(documentId);
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

  // Connectors follow the annotations they are attached to; jump links follow their
  // markers (and go when the marker is deleted).
  useEffect(() => {
    if (!scope) return;
    const { update, remove } = reroutes(Object.values(state.byUid).map((t) => t.object));
    for (const u of update) scope.updateAnnotation(u.pageIndex, u.id, u.patch);
    for (const r of remove) scope.deleteAnnotation(r.pageIndex, r.id);
  }, [scope, state.byUid]);

  // A selected cross-page connector end: where its other end is.
  const [only, ...more] = state.selectedUids;
  const selected = only && !more.length ? state.byUid[only] : null;
  const sel = selected ? pwData(selected.object) : null;
  const partner =
    sel?.pwType === "Connector" && sel.pwPair
      ? Object.values(state.byUid).find((t) => {
          const d = pwData(t.object);
          return d?.pwType === "Connector" && d.pwPair === sel.pwPair && d.pwEnd !== sel.pwEnd;
        })?.object
      : undefined;

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

  const jump = partner && (
    <button
      type="button"
      className="connector-jump"
      onClick={() => {
        scroll?.scrollToPage({
          pageNumber: partner.pageIndex + 1,
          pageCoordinates: { x: partner.rect.origin.x, y: partner.rect.origin.y },
          behavior: "instant",
          alignY: 30,
        });
        scope?.selectAnnotation(partner.pageIndex, partner.id);
      }}
    >
      Go to the other end (page {partner.pageIndex + 1})
    </button>
  );
  // A selected calculator tape opens in the calculator for changes.
  const tape = sel?.pwType === "Tape" && selected ? selected.object : null;
  const editTape = tape && (
    <button
      type="button"
      className="connector-jump"
      onClick={() => {
        const lines = (sel?.pwTape ?? []) as TapeLine[];
        calcStore.set({
          calc: { ...EMPTY_CALC, tape: lines, shown: lines.at(-1)?.value ?? 0 },
          editing: { documentId, pageIndex: tape.pageIndex, id: tape.id, rect: tape.rect },
          footing: null,
        });
        wb.updateSettings({ calcOpen: true });
      }}
    >
      Open this tape in the calculator
    </button>
  );
  const calc = wb.settings.calcOpen && flyer && <CalculatorPanel documentId={documentId} />;
  if (!wb.settings.tickmarkPaletteOpen || !flyer)
    return (
      <>
        {jump}
        {editTape}
        {calc}
      </>
    );
  return (
    <>
      {jump}
      {editTape}
      {calc}
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
    </>
  );
}
