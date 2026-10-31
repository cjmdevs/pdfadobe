// Floating calculator (Phase 4 stage 3; laid out as PDFlyer's 10 Key Calculator since B6):
// a tape grid (Section | Note | Amount | Op.), a seven-segment display and PDFlyer's keys.
// Amounts can be clicked on the page, a column or row footed against its total, and the
// tape placed on the page as an annotation (To PDF; or an existing tape updated).
import type { PdfFreeTextAnnoObject } from "@embedpdf/models";
import { useEffect, useRef, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { useWorkbench } from "../../app/workbench";
import { BUILT_IN_TICKMARKS, drawTickmark } from "../../engine/flyer/tickmarks";
import {
  CALC_DECIMALS,
  EMPTY_CALC,
  deleteLine,
  display,
  footTape,
  formatAmount,
  press,
  textLine,
  type CalcDecimals,
  type CalcKey,
  type CalcSettings,
  type TapeLine,
  type TapeOp,
} from "../../flyer/calc";
import { tickmarkSubject } from "../../flyer/items";
import { tapeAnnotation, tapeBox, tapeData, tapeLines } from "../../flyer/tapeRows";
import { calcStore, useCalcView } from "./calcStore";
import { placeArt } from "./FlyerLayer";
import { FLYER_MODE, flyerPlacement, usePendingItem } from "./flyerStore";

type Action = "decimals" | "toPdf" | "deleteLine" | "dateTime";
interface Key {
  k: CalcKey | Action;
  label: string;
  /** Accessible name when the label is a symbol or short. */
  name?: string;
  col: number;
  row: number;
  rows?: number;
  cols?: number;
}

/** PDFlyer's 10 Key Calculator, key for key (owner's screenshot): 7 columns, 6 rows. The
 * diamond is the subtotal and * the total, as on a printing calculator. */
const KEYS: Key[] = [
  { k: "MC", label: "MC", name: "Memory clear", col: 1, row: 1 },
  { k: "MS", label: "MS", name: "Memory store", col: 2, row: 1 },
  { k: "MR", label: "MR", name: "Memory recall", col: 3, row: 1 },
  { k: "M-", label: "M-", name: "Memory minus", col: 4, row: 1 },
  { k: "M+", label: "M+", name: "Memory plus", col: 5, row: 1 },
  { k: "decimals", label: "", col: 6, row: 1 },
  { k: "NewTape", label: "New Tape", col: 7, row: 1 },
  { k: "Backspace", label: "→", name: "Backspace", col: 1, row: 2 },
  { k: "C", label: "C", col: 2, row: 2 },
  { k: "CE", label: "CE", col: 3, row: 2 },
  { k: "Neg", label: "+/-", name: "Change sign", col: 4, row: 2 },
  { k: "%", label: "%", name: "Percent", col: 5, row: 2 },
  { k: "AddLine", label: "Add Line", col: 6, row: 2 },
  { k: "toPdf", label: "To PDF", col: 7, row: 2 },
  { k: "dateTime", label: "Date Time", col: 1, row: 3, rows: 2 },
  { k: "7", label: "7", col: 2, row: 3 },
  { k: "8", label: "8", col: 3, row: 3 },
  { k: "9", label: "9", col: 4, row: 3 },
  { k: "-", label: "−\n=", name: "Minus equals", col: 5, row: 3, rows: 2 },
  { k: "deleteLine", label: "Delete Line", col: 6, row: 3 },
  { k: "GT", label: "GT", name: "Grand total", col: 7, row: 3 },
  { k: "4", label: "4", col: 2, row: 4 },
  { k: "5", label: "5", col: 3, row: 4 },
  { k: "6", label: "6", col: 4, row: 4 },
  { k: "/", label: "÷", name: "Divide", col: 6, row: 4 },
  { k: "S", label: "◇", name: "Subtotal", col: 7, row: 4 },
  { k: "000", label: "000", col: 1, row: 5 },
  { k: "1", label: "1", col: 2, row: 5 },
  { k: "2", label: "2", col: 3, row: 5 },
  { k: "3", label: "3", col: 4, row: 5 },
  { k: "+", label: "+\n=", name: "Plus equals", col: 5, row: 5, rows: 2 },
  { k: "*", label: "×", name: "Multiply", col: 6, row: 5, rows: 2 },
  { k: "T", label: "*", name: "Total", col: 7, row: 5, rows: 2 },
  { k: "00", label: "00", col: 1, row: 6 },
  { k: "0", label: "0", col: 2, row: 6, cols: 2 },
  { k: ".", label: ".", name: "Point", col: 4, row: 6 },
];

/** How a tape line's operation shows in the tape grid. */
const OP_SHOWN: Partial<Record<TapeOp, string>> = { T: "*", S: "◇", G: "GT", "#": "", "@": "" };

/** Keyboard key -> calculator key (numpad included). */
function keyOf(e: KeyboardEvent): CalcKey | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const k = e.key;
  if (/^[0-9]$/.test(k) || k === "." || k === "+" || k === "-" || k === "*" || k === "/")
    return k as CalcKey;
  if (k === "Enter" || k === "=") return "=";
  if (k === "Backspace") return "Backspace";
  if (k === "Delete") return "CE";
  if (k === "%") return "%";
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
  const tapeEnd = useRef<HTMLTableSectionElement>(null);
  /** The tape line Delete Line removes (the last when none is picked). */
  const [picked, setPicked] = useState<number | null>(null);
  const [closed, setClosed] = useState<ReadonlySet<number>>(new Set());
  /** Moved by its title bar, like PDFlyer's calculator window. */
  const [moved, setMoved] = useState({ x: 0, y: 0 });
  const dragFrom = useRef<{ x: number; y: number } | null>(null);

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

  const act = (k: CalcKey | Action) => {
    const cur = calcStore.get().calc;
    if (k === "toPdf") placeTape();
    else if (k === "deleteLine") {
      calcStore.set({ calc: deleteLine(cur, picked ?? cur.tape.length - 1, cfg) });
      setPicked(null);
    } else if (k === "dateTime")
      calcStore.set({
        calc: textLine(
          cur,
          new Date().toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }),
        ),
      });
    else if (k !== "decimals") key(k);
  };

  const setNote = (i: number, note: string) => {
    const cur = calcStore.get().calc;
    const tape = cur.tape.map((l, j) => {
      if (j !== i) return l;
      const rest: TapeLine = { op: l.op, value: l.value, ...(l.sec ? { sec: l.sec } : {}) };
      return note ? { ...rest, note } : rest;
    });
    calcStore.set({ calc: { ...cur, tape } });
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
  // The tape grid: each section's heading row ("1 - 0"), then its lines ("1 - 1"...).
  const grid: ({ head: number } | { i: number; label: string })[] = [];
  {
    let sec = 0;
    let n = 0;
    for (const [i, l] of calc.tape.entries()) {
      const s = l.sec ?? 1;
      if (s !== sec) {
        sec = s;
        n = 0;
        grid.push({ head: s });
      }
      n++;
      if (!closed.has(s)) grid.push({ i, label: `${s} - ${n}` });
    }
  }
  const toggle = (sec: number) =>
    setClosed((c) => {
      const next = new Set(c);
      if (!next.delete(sec)) next.add(sec);
      return next;
    });

  return (
    <div
      className="calc-panel"
      role="dialog"
      aria-label="Calculator"
      data-testid="calculator"
      style={{ transform: `translate(${moved.x}px, ${moved.y}px)` }}
    >
      <header
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest("select, button")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragFrom.current = { x: e.clientX - moved.x, y: e.clientY - moved.y };
        }}
        onPointerMove={(e) => {
          const f = dragFrom.current;
          const panel = e.currentTarget.parentElement;
          const area = panel?.offsetParent;
          if (!f || !panel || !area) return;
          // Kept inside its area: past the edge it would scroll the pages sideways.
          const a = area.getBoundingClientRect();
          const p = panel.getBoundingClientRect();
          const x = e.clientX - f.x;
          const y = e.clientY - f.y;
          setMoved({
            x: Math.min(Math.max(x, moved.x + a.left - p.left), moved.x + a.right - p.right),
            y: Math.min(Math.max(y, moved.y + a.top - p.top), moved.y + a.bottom - p.bottom),
          });
        }}
        onPointerUp={() => (dragFrom.current = null)}
      >
        <select
          aria-label="Calculator type"
          value={cfg.mode}
          onChange={(e) => {
            setCfg({ mode: e.target.value === "standard" ? "standard" : "tenKey" });
            calcStore.set({ calc: { ...EMPTY_CALC, tape: calc.tape } });
          }}
        >
          <option value="tenKey">10 Key Calculator</option>
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
      <div className="calc-tape">
        <table aria-label="Tape">
          <thead>
            <tr>
              <th>Section</th>
              <th>Note</th>
              <th>Amount</th>
              <th>Op.</th>
            </tr>
          </thead>
          <tbody ref={tapeEnd}>
            {grid.map((g) => {
              if ("head" in g)
                return (
                  <tr key={`h${g.head}`} className="sec">
                    <td colSpan={4}>
                      <button
                        type="button"
                        aria-expanded={!closed.has(g.head)}
                        onClick={() => toggle(g.head)}
                      >
                        {closed.has(g.head) ? "›" : "⌄"} {g.head} - 0
                      </button>
                    </td>
                  </tr>
                );
              const l = calc.tape[g.i];
              return (
                l && (
                  <TapeRow
                    key={g.i}
                    label={g.label}
                    line={l}
                    decimals={cfg.decimals}
                    picked={picked === g.i}
                    onPick={() => setPicked(picked === g.i ? null : g.i)}
                    onNote={(n) => setNote(g.i, n)}
                  />
                )
              );
            })}
          </tbody>
        </table>
      </div>
      <output className="calc-display" data-testid="calc-display">
        <span className="visually-hidden">{display(calc, cfg)}</span>
        <SevenSegment text={display(calc, cfg)} />
      </output>
      <div className="calc-keys">
        {KEYS.map((b) =>
          b.k === "decimals" ? (
            <select
              key="decimals"
              aria-label="Decimal places"
              style={{ gridColumn: b.col, gridRow: b.row }}
              value={String(cfg.decimals)}
              onChange={(e) =>
                setCfg({
                  decimals: (e.target.value === "F" ? "F" : Number(e.target.value)) as CalcDecimals,
                })
              }
            >
              {CALC_DECIMALS.map((d) => (
                <option key={d} value={String(d)}>
                  {d}
                </option>
              ))}
            </select>
          ) : (
            <button
              key={b.k}
              type="button"
              className={/^[0-9.]+$/.test(b.k) ? "num" : undefined}
              aria-label={b.k === "toPdf" ? (editing ? "Update tape" : "To PDF") : b.name}
              disabled={(b.k === "toPdf" || b.k === "deleteLine") && !calc.tape.length}
              style={{
                gridColumn: `${b.col} / span ${b.cols ?? 1}`,
                gridRow: `${b.row} / span ${b.rows ?? 1}`,
              }}
              onClick={() => act(b.k)}
            >
              {b.label}
            </button>
          ),
        )}
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
                        calc: {
                          ...calc,
                          tape: [
                            ...calc.tape,
                            ...footTape(footing.values, r).map((l) =>
                              calc.sec === 1 ? l : { ...l, sec: calc.sec },
                            ),
                          ],
                        },
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
      <details>
        <summary>Settings</summary>
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
        <button
          type="button"
          onClick={() => {
            calcStore.set({ calc: EMPTY_CALC, editing: null });
            setPicked(null);
          }}
        >
          Clear tape
        </button>
      </details>
    </div>
  );
}

function TapeRow({
  label,
  line,
  decimals,
  picked,
  onPick,
  onNote,
}: {
  label: string;
  line: TapeLine;
  decimals: CalcDecimals;
  picked: boolean;
  onPick: () => void;
  onNote: (note: string) => void;
}) {
  const cls = [picked ? "picked" : "", line.value < 0 ? "neg" : ""].join(" ").trim();
  return (
    <tr className={cls || undefined} aria-selected={picked} onClick={onPick}>
      <td>{label}</td>
      <td>
        <input
          aria-label={`Note for ${label}`}
          value={line.note ?? ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onNote(e.target.value)}
        />
      </td>
      <td className="amt">{line.op === "@" ? "" : formatAmount(line.value, decimals)}</td>
      <td>{OP_SHOWN[line.op] ?? line.op}</td>
    </tr>
  );
}

/** Which of the seven segments (a-g) each character lights. */
const SEGMENTS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abdeg",
  "3": "abcdg",
  "4": "bcfg",
  "5": "acdfg",
  "6": "acdefg",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  "-": "g",
  E: "adefg",
  r: "eg",
  o: "cdeg",
};
const SEG_PATH: Record<string, string> = {
  a: "M3 1h7l-1.5 2h-4z",
  b: "M11 1.5v8l-2-1.2v-5.3z",
  c: "M11 10.5v8l-2-1.5v-5.3z",
  d: "M3 19h7l-1.5-2h-4z",
  e: "M2 10.5v8l2-1.5v-5.3z",
  f: "M2 1.5v8l2-1.2v-5.3z",
  g: "M3 10l1.3-1h4.4l1.3 1-1.3 1h-4.4z",
};

/** The display drawn like PDFlyer's LCD (decorative; the text is read from the output). */
function SevenSegment({ text }: { text: string }) {
  const cells: { ch: string; dot: boolean }[] = [];
  for (const ch of text.replace(/,/g, "")) {
    const last = cells.at(-1);
    if (ch === "." && last && !last.dot) last.dot = true;
    else cells.push({ ch, dot: false });
  }
  return (
    <svg
      aria-hidden="true"
      className="seven-seg"
      viewBox={`0 0 ${Math.max(1, cells.length) * 14} 20`}
      style={{ width: `${Math.max(1, cells.length) * 0.7}em` }}
    >
      {cells.map((c, i) => (
        <g key={i} transform={`translate(${i * 14 + 1} 0) skewX(-6)`}>
          {[..."abcdefg"].map((seg) => (
            <path
              key={seg}
              d={SEG_PATH[seg]}
              className={(SEGMENTS[c.ch] ?? "").includes(seg) ? "on" : "off"}
            />
          ))}
          {c.dot && <rect x="11.5" y="17.5" width="2" height="2" className="on" />}
        </g>
      ))}
    </svg>
  );
}
