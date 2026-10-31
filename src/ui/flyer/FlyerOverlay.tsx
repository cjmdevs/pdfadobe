// Per document (Phase 4): the floating tickmark palette, number keys 1-9 to switch the
// armed tickmark, the Stamp Summary rows for the CSV export, connectors kept attached to
// what they point at, "go to the other end" for a selected cross-page connector, and links
// between matching letter/number tickmarks ("go to the next A").
import { useEffect, useMemo, useRef } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useDocumentState } from "@embedpdf/core/react";
import { reroutes } from "../../flyer/connectors";
import { nextLinked, tickLinkChanges } from "../../flyer/tickLinks";
import { foreignItem, pwData } from "../../flyer/items";
import { parseTapeText } from "../../flyer/tapeRows";
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
  const doc = useDocumentState(documentId);
  const pages = doc?.document?.pages;
  const flyer = useDocToolContext(documentId).flyer;
  const rows = useMemo(
    () =>
      summaryRows(
        Object.values(state.byUid).map((t) => t.object),
        (i) => pages?.[i]?.size,
      ),
    [state.byUid, pages],
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

  // Matching letter/number tickmarks: each has a link to the next one with its value.
  useEffect(() => {
    if (!scope || !pages) return;
    const links = tickLinkChanges(
      Object.values(state.byUid).map((t) => t.object),
      (i) => pages[i]?.size.height ?? 792,
    );
    for (const r of links.remove) scope.deleteAnnotation(r.pageIndex, r.id);
    for (const l of links.create) scope.createAnnotation(l.pageIndex, l);
  }, [scope, state.byUid, pages]);

  // A selected cross-page connector end: where its other end is.
  const [only, ...more] = state.selectedUids;
  const selected = only && !more.length ? state.byUid[only] : null;
  const sel = selected ? pwData(selected.object) : null;
  const all = Object.values(state.byUid).map((t) => t.object);
  // A letter/number tickmark (or the link over it, if that got the click): the next one.
  const linked =
    sel?.pwType === "TickLink"
      ? all.find((a) => a.id === sel.pwOf)
      : sel?.pwType === "Tickmark" && sel.pwLink
        ? selected?.object
        : undefined;
  const linkedNext = linked ? nextLinked(all, linked) : null;
  const linkedLabel = linked ? pwData(linked)?.pwLabel : undefined;
  const partner =
    sel?.pwType === "Connector" && sel.pwPair
      ? all.find((a) => {
          const d = pwData(a);
          return d?.pwType === "Connector" && d.pwPair === sel.pwPair && d.pwEnd !== sel.pwEnd;
        })
      : (linkedNext ?? undefined);

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
      {linkedNext
        ? `Go to the next ${linkedLabel ?? ""} (page ${partner.pageIndex + 1})`
        : `Go to the other end (page ${partner.pageIndex + 1})`}
    </button>
  );
  // A selected calculator tape opens in the calculator for changes.
  const tape =
    selected &&
    (sel?.pwType === "Tape" || (!sel && foreignItem(selected.object)?.type === "PdflyerTape"))
      ? selected.object
      : null;
  const editTape = tape && (
    <button
      type="button"
      className="connector-jump"
      onClick={() => {
        const lines = (sel?.pwTape ?? parseTapeText(tape.contents ?? "")) as TapeLine[];
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
