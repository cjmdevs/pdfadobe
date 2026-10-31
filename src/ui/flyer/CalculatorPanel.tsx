// Floating calculator (Phase 4 stage 3): 10-key adding machine or standard calculator
// with a tape. Amounts can be clicked on the page, a column or row footed against its
// total, and the tape placed on the page as an annotation (or an existing tape updated).
import type { PdfFreeTextAnnoObject } from "@embedpdf/models";
import { useEffect, useRef } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { useWorkbench } from "../../app/workbench";
import { BUILT_IN_TICKMARKS, drawTickmark } from "../../engine/flyer/tickmarks";
import {
  EMPTY_CALC,
  display,
  footTape,
  formatAmount,
  press,
  type CalcDecimals,
  type CalcKey,
  type CalcSettings,
} from "../../flyer/calc";
import { tickmarkSubject } from "../../flyer/items";
import { tapeAnnotation, tapeBox, tapeData, tapeLines } from "../../flyer/tapeRows";
import { calcStore, useCalcView } from "./calcStore";
import { placeArt } from "./FlyerLayer";
import { FLYER_MODE, flyerPlacement, usePendingItem } from "./flyerStore";

const KEYS_10: CalcKey[][] = [
  ["7", "8", "9", "/"],
  ["4", "5", "6", "*"],
  ["1", "2", "3", "-"],
  ["0", "00", ".", "+"],
  ["C", "CE", "Backspace", "="],
  ["S", "T"],
];
const LABEL: Partial<Record<CalcKey, string>> = {
  "/": "÷",
  "*": "×",
  "-": "−",
  Backspace: "⌫",
  S: "Sub",
  T: "Total",
};

/** Keyboard key -> calculator key (numpad included). */
function keyOf(e: KeyboardEvent): CalcKey | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const k = e.key;
  if (/^[0-9]$/.test(k) || k === "." || k === "+" || k === "-" || k === "*" || k === "/")
    return k as CalcKey;
  if (k === "Enter" || k === "=") return "=";
  if (k === "Backspace") return "Backspace";
  if (k === "t" || k === "T") return "T";
  if (k === "s" || k === "S") return "S";
  if (k === "c" || k === "C") return "C";
  return null;
}

export function CalculatorPanel({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const cfg = wb.settings.calc;
  const setCfg = (patch: Partial<CalcSettings>) =>
    wb.updateSettings({ calc: { ...cfg, ...patch } });
  const { calc, footing, editing } = useCalcView();
  const { provides: scope } = useAnnotation(documentId);
  const { provides: im, state: imState } = useInteractionManager(documentId);
  const doc = useDocumentState(documentId);
  const pending = usePendingItem();
  const mode = imState.activeMode === FLYER_MODE ? pending?.kind : undefined;
  const tapeEnd = useRef<HTMLOListElement>(null);

  const key = (k: CalcKey) => calcStore.set({ calc: press(calcStore.get().calc, k, cfg) });

  // Typing goes to the calculator while it is open (not into text boxes, and not the
  // number keys that switch tickmarks while placing them).
  const latest = useRef({ cfg, placingTick: mode === "tickmark" });
  useEffect(() => {
    latest.current = { cfg, placingTick: mode === "tickmark" };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      if (latest.current.placingTick) return;
      const k = keyOf(e);
      if (!k) return;
      e.preventDefault();
      e.stopPropagation();
      calcStore.set({ calc: press(calcStore.get().calc, k, latest.current.cfg) });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(() => {
    tapeEnd.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [calc.tape.length]);

  const arm = (kind: "pick" | "foot") => {
    if (mode === kind) {
      flyerPlacement.set(null);
      im?.activateDefaultMode();
      return;
    }
    scope?.setActiveTool(null);
    scope?.deselectAnnotation();
    if (kind === "foot") calcStore.set({ footing: null });
    flyerPlacement.set({ kind, width: 0, height: 0 });
    im?.activate(FLYER_MODE);
    wb.toast(
      kind === "pick"
        ? "Click amounts on the page to send them to the calculator (Shift+click subtracts). Esc stops."
        : "Drag around a column (foot) or a row (cross-foot) of amounts, then click its total.",
    );
  };

  const placeTape = () => {
    if (!calc.tape.length) return;
    if (editing && editing.documentId === documentId && scope) {
      // Changed in place, its top-left corner kept (a PDFlyer tape becomes ours).
      const size = doc?.document?.pages[editing.pageIndex]?.size;
      if (!size) return;
      const fresh = tapeAnnotation(
        calc.tape,
        cfg.decimals,
        cfg.tapeColor,
        {
          pageIndex: editing.pageIndex,
          x: editing.rect.origin.x,
          y: editing.rect.origin.y,
          page: size,
        },
        wb.author,
        editing.id,
      );
      // Its text, box, look and tags; who made it and when stay.
      const patch: Partial<PdfFreeTextAnnoObject> = {
        contents: fresh.contents,
        rect: fresh.rect,
        fontFamily: fresh.fontFamily,
        fontSize: fresh.fontSize,
        fontColor: fresh.fontColor,
        flags: fresh.flags ?? [],
        custom: fresh.custom,
        modified: new Date(),
        ...(fresh.subject ? { subject: fresh.subject } : {}),
        ...(fresh.defaultStyle ? { defaultStyle: fresh.defaultStyle } : {}),
        ...(fresh.color ? { color: fresh.color, backgroundColor: fresh.color } : {}),
      };
      scope.updateAnnotation(editing.pageIndex, editing.id, patch);
      calcStore.set({ editing: null });
      wb.toast("Tape updated.");
      return;
    }
    scope?.setActiveTool(null);
    const box = tapeBox(tapeLines(tapeData(calc.tape, cfg.decimals)));
    flyerPlacement.set({ kind: "tape", ...box });
    im?.activate(FLYER_MODE);
    wb.toast("Click on the page to place the tape (Esc cancels).");
  };

  /** Footed / Cross-footed when it agrees, Unreconciled Difference when not. */
  const markTotal = async () => {
    const r = footing?.result;
    const at = footing?.totalRect;
    const size = footing ? doc?.document?.pages[footing.pageIndex]?.size : undefined;
    if (!footing || !r || !at || !size || !scope) return;
    const id = r.variance === 0 ? (r.across ? "crossFooted" : "footed") : "unreconciled";
    const def = BUILT_IN_TICKMARKS.find((d) => d.id === id);
    if (!def) return;
    const art = await drawTickmark(def);
    placeArt(
      scope,
      wb,
      footing.pageIndex,
      size,
      {
        x: at.origin.x + at.size.width + art.width / 2 + 2,
        y: at.origin.y + at.size.height / 2,
      },
      art,
      {
        subject: tickmarkSubject(def),
        contents: def.meaning,
        custom: { pwType: "Tickmark", pwTick: def.id },
      },
    );
  };

  const r = footing?.result;
  const rows = cfg.mode === "tenKey" ? KEYS_10 : KEYS_10.slice(0, 5);
  return (
    <div className="calc-panel" role="dialog" aria-label="Calculator" data-testid="calculator">
      <header>
        <select
          aria-label="Calculator type"
          value={cfg.mode}
          onChange={(e) => {
            setCfg({ mode: e.target.value === "standard" ? "standard" : "tenKey" });
            calcStore.set({ calc: { ...EMPTY_CALC, tape: calc.tape } });
          }}
        >
          <option value="tenKey">10-key (adding machine)</option>
          <option value="standard">Standard</option>
        </select>
        <button
          type="button"
          className="tool"
          aria-label="Close the calculator"
          onClick={() => wb.updateSettings({ calcOpen: false })}
        >
          ×
        </button>
      </header>
      <output className="calc-display" data-testid="calc-display">
        {display(calc, cfg)}
      </output>
      <div className="calc-keys">
        {rows.flat().map((k) => (
          <button
            key={k}
            type="button"
            aria-label={k === "Backspace" ? "Backspace" : (LABEL[k] ?? k)}
            onClick={() => key(k)}
          >
            {LABEL[k] ?? k}
          </button>
        ))}
      </div>
      <div className="calc-actions">
        <button type="button" aria-pressed={mode === "pick"} onClick={() => arm("pick")}>
          Click amounts on page
        </button>
        <button type="button" aria-pressed={mode === "foot"} onClick={() => arm("foot")}>
          Foot / cross-foot
        </button>
      </div>
      {footing && (
        <div className="calc-foot" role="status" data-testid="foot-result">
          {footing.stage === "total" ? (
            <>
              {footing.values.length} amount(s) selected, click the total.{" "}
              <button
                type="button"
                onClick={() =>
                  calcStore.set({
                    footing: {
                      ...footing,
                      stage: "done",
                      result: {
                        count: footing.values.length,
                        sum: footing.values.reduce((a, b) => a + b, 0),
                        total: null,
                        variance: null,
                        across: footing.across,
                      },
                    },
                  })
                }
              >
                No total
              </button>
            </>
          ) : (
            r && (
              <>
                <div>
                  {r.across ? "Cross-foot" : "Foot"} of {r.count}:{" "}
                  <b>{formatAmount(r.sum, cfg.decimals)}</b>
                </div>
                {r.total !== null && r.variance !== null && (
                  <div className={r.variance === 0 ? "agrees" : "variance"}>
                    Total {formatAmount(r.total, cfg.decimals)} ·{" "}
                    {r.variance === 0
                      ? "agrees"
                      : `variance ${formatAmount(r.variance, cfg.decimals)}`}
                  </div>
                )}
                <div className="row">
                  <button
                    type="button"
                    onClick={() =>
                      calcStore.set({
                        calc: { ...calc, tape: [...calc.tape, ...footTape(footing.values, r)] },
                      })
                    }
                  >
                    Add to tape
                  </button>
                  {r.total !== null && (
                    <button type="button" onClick={() => void markTotal()}>
                      Mark total
                    </button>
                  )}
                  <button type="button" onClick={() => calcStore.set({ footing: null })}>
                    Clear
                  </button>
                </div>
              </>
            )
          )}
        </div>
      )}
      <ol
        className="calc-tape"
        ref={tapeEnd}
        aria-label="Tape"
        style={{ background: cfg.tapeColor }}
      >
        {calc.tape.map((l, i) => (
          <li key={i} className={l.value < 0 ? "neg" : undefined}>
            <span>{formatAmount(l.value, cfg.decimals)}</span>
            <span className="op">{l.op === "#" ? "" : l.op}</span>
            {l.note && <small>{l.note}</small>}
          </li>
        ))}
      </ol>
      <div className="row">
        <button type="button" disabled={!calc.tape.length} onClick={placeTape}>
          {editing ? "Update tape" : "Place tape on page"}
        </button>
        <button type="button" onClick={() => calcStore.set({ calc: EMPTY_CALC, editing: null })}>
          Clear tape
        </button>
      </div>
      <details>
        <summary>Settings</summary>
        <label>
          Decimals{" "}
          <select
            value={String(cfg.decimals)}
            onChange={(e) =>
              setCfg({
                decimals: (e.target.value === "F" ? "F" : Number(e.target.value)) as CalcDecimals,
              })
            }
          >
            <option value="2">2</option>
            <option value="0">0</option>
            <option value="F">Floating</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={cfg.addMode}
            onChange={(e) => setCfg({ addMode: e.target.checked })}
          />
          Add mode (1234 = 12.34)
        </label>
        <label>
          Tape color{" "}
          <input
            type="color"
            value={cfg.tapeColor}
            onChange={(e) => setCfg({ tapeColor: e.target.value })}
          />
        </label>
      </details>
    </div>
  );
}
