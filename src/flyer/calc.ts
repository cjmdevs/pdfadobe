// Calculator (Phase 4 stage 3; keys as PDFlyer's 10 Key Calculator since B6): a 10-key
// adding machine and a standard calculator, both printing to a tape. Pure state in, state out; no React. Amounts are kept as numbers
// and rounded to cents for display and totals (no binary-fraction noise like 0.1+0.2).

export type CalcMode = "tenKey" | "standard";
/** Decimal places shown; "F" = as many as needed. */
export type CalcDecimals = 0 | 1 | 2 | 3 | 4 | "F";
export const CALC_DECIMALS: readonly CalcDecimals[] = [0, 1, 2, 3, 4, "F"];

export interface CalcSettings {
  mode: CalcMode;
  decimals: CalcDecimals;
  /** Adding-machine "add mode": digits typed without a point get two implied decimals. */
  addMode: boolean;
  /** Tape paper color, "#rrggbb". */
  tapeColor: string;
}

export const DEFAULT_CALC: CalcSettings = {
  mode: "tenKey",
  decimals: 2,
  addMode: false,
  tapeColor: "#C0C0C0",
};

/** The tape colour before B6 (pale yellow): read as the new default, PDFlyer's grey. */
const OLD_TAPE_COLOR = "#FFFDE7";

/** Calculator settings from a file or settings; anything wrong falls back. */
export function sanitizeCalc(v: unknown): CalcSettings {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    mode: r.mode === "standard" ? "standard" : "tenKey",
    decimals: CALC_DECIMALS.includes(r.decimals as CalcDecimals) ? (r.decimals as CalcDecimals) : 2,
    addMode: r.addMode === true,
    tapeColor:
      typeof r.tapeColor === "string" &&
      /^#[0-9a-f]{6}$/i.test(r.tapeColor) &&
      r.tapeColor.toUpperCase() !== OLD_TAPE_COLOR
        ? r.tapeColor
        : DEFAULT_CALC.tapeColor,
  };
}

/** "+" "-" add/subtract; "×" "÷" operands; "=" result; "T" total (*); "S" subtotal (◇);
 * "G" grand total; "" a first operand (standard); "#" a number printed but not added
 * (a note, Add Line); "@" a line of text only (Date Time; its value is 0, not printed). */
export type TapeOp = "+" | "-" | "×" | "÷" | "=" | "T" | "S" | "G" | "" | "#" | "@";

export interface TapeLine {
  op: TapeOp;
  value: number;
  /** Text after the amount ("Total on page", "Variance"). */
  note?: string;
  /** Tape section (New Tape starts the next); 1 when missing. */
  sec?: number;
}

export interface CalcState {
  /** What is being typed (digits, one point), or "". */
  entry: string;
  /** Running total (10-key) or left operand (standard). */
  acc: number;
  /** × or ÷ waiting for its second number. */
  pending: { op: "×" | "÷"; value: number } | null;
  /** Standard mode: + or - waiting for its second number. */
  pendingAdd: "+" | "-" | null;
  /** What the display shows when nothing is typed. */
  shown: number;
  tape: TapeLine[];
  /** Memory (MS, M+, M-, MR, MC). */
  mem: number;
  /** Tape section new lines go in (New Tape starts the next). */
  sec: number;
  /** Totals since the tape began, for GT. */
  gt: number;
}

export const EMPTY_CALC: CalcState = {
  entry: "",
  acc: 0,
  pending: null,
  pendingAdd: null,
  shown: 0,
  tape: [],
  mem: 0,
  sec: 1,
  gt: 0,
};

/** Rounds to 10 places: sums of cents stay exact enough to print and compare. */
export const tidy = (v: number) => Math.round(v * 1e10) / 1e10;

export function formatAmount(v: number, decimals: CalcDecimals): string {
  const n = tidy(v);
  return decimals === "F"
    ? n.toLocaleString("en-US", { maximumFractionDigits: 10 })
    : n.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
}

function entryValue(s: CalcState, cfg: CalcSettings): number | null {
  if (!s.entry) return null;
  const v = Number(s.entry);
  if (!Number.isFinite(v)) return null;
  return cfg.addMode && !s.entry.includes(".") ? v / 100 : v;
}

const apply = (a: number, op: "×" | "÷" | "+" | "-", b: number) =>
  tidy(op === "×" ? a * b : op === "÷" ? (b === 0 ? NaN : a / b) : op === "+" ? a + b : a - b);

export type CalcKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "00"
  | "000"
  | "."
  | "+"
  | "-"
  | "*"
  | "/"
  | "="
  | "T"
  | "S"
  | "C"
  | "CE"
  | "Backspace"
  | "MC"
  | "MS"
  | "MR"
  | "M-"
  | "M+"
  /** +/- */
  | "Neg"
  | "%"
  | "GT"
  /** New Tape: the next section, running total back to 0. */
  | "NewTape"
  /** Add Line: the amount printed on the tape, not added. */
  | "AddLine";

/** A tape line in the section being keyed. */
const line = (s: CalcState, l: TapeLine): TapeLine => (s.sec === 1 ? l : { ...l, sec: s.sec });

export function press(s: CalcState, key: CalcKey, cfg: CalcSettings): CalcState {
  if (/^\d+$/.test(key)) {
    if (s.entry.replace(/\D/g, "").length >= 15) return s;
    return { ...s, entry: s.entry === "0" ? key.replace(/^0+/, "") || "0" : s.entry + key };
  }
  if (key === ".") return s.entry.includes(".") ? s : { ...s, entry: (s.entry || "0") + "." };
  if (key === "Backspace") return { ...s, entry: s.entry.slice(0, -1) };
  if (key === "CE") return { ...s, entry: "" };
  if (key === "C") return { ...EMPTY_CALC, tape: s.tape, mem: s.mem, sec: s.sec, gt: s.gt };
  const typed = entryValue(s, cfg);
  const value = typed ?? s.shown;
  const recall = (v: number): CalcState => ({ ...s, entry: Number.isFinite(v) ? String(v) : "" });
  switch (key) {
    case "MC":
      return { ...s, mem: 0 };
    case "MS":
      return { ...s, mem: value };
    case "MR":
      return recall(s.mem);
    case "M+":
    case "M-":
      return { ...s, mem: apply(s.mem, key === "M+" ? "+" : "-", value) };
    case "Neg":
      return recall(tidy(-value));
    case "%":
      // Percent of the number waiting (× or ÷) or of the running total.
      return recall(tidy(((s.pending?.value ?? s.acc) * value) / 100));
    case "AddLine":
      return { ...s, entry: "", shown: value, tape: [...s.tape, line(s, { op: "#", value })] };
    case "GT":
      return { ...s, entry: "", shown: s.gt, tape: [...s.tape, line(s, { op: "G", value: s.gt })] };
    case "NewTape":
      return { ...EMPTY_CALC, tape: s.tape, mem: s.mem, gt: s.gt, sec: s.sec + 1 };
    default:
      return cfg.mode === "tenKey" ? tenKey(s, key, cfg) : standard(s, key, cfg);
  }
}

/** A line of text (Date Time) on the tape. */
export function textLine(s: CalcState, text: string): CalcState {
  return { ...s, tape: [...s.tape, line(s, { op: "@", value: 0, note: text })] };
}

/** The tape without line `index`; the running total, subtotals and totals worked out again
 * from the lines left (× ÷ lines stay as printed). */
export function deleteLine(s: CalcState, index: number, cfg: CalcSettings): CalcState {
  if (index < 0 || index >= s.tape.length) return s;
  const tape: TapeLine[] = [];
  const acc = new Map<number, number>();
  let gt = 0;
  for (const [i, l] of s.tape.entries()) {
    if (i === index) continue;
    const sec = l.sec ?? 1;
    const a = acc.get(sec) ?? 0;
    if (l.op === "+" || l.op === "-") acc.set(sec, apply(a, l.op, l.value));
    if (l.op === "S") {
      tape.push({ ...l, value: a });
      continue;
    }
    if (l.op === "T") {
      gt = tidy(gt + a);
      acc.set(sec, 0);
      tape.push({ ...l, value: a });
      continue;
    }
    if (l.op === "G") {
      tape.push({ ...l, value: gt });
      continue;
    }
    tape.push(l);
  }
  const now = acc.get(s.sec) ?? 0;
  return { ...s, tape, gt, ...(cfg.mode === "standard" ? {} : { acc: now, shown: now }) };
}

function tenKey(s: CalcState, key: CalcKey, cfg: CalcSettings): CalcState {
  const typed = entryValue(s, cfg);
  switch (key) {
    case "+":
    case "-": {
      // -= and += finish a waiting × or ÷ and add (or subtract) the result.
      if (s.pending && typed !== null) {
        const r = apply(s.pending.value, s.pending.op, typed);
        const acc = apply(s.acc, key, r);
        return {
          ...s,
          entry: "",
          pending: null,
          acc,
          shown: acc,
          tape: [...s.tape, line(s, { op: "=", value: typed }), line(s, { op: key, value: r })],
        };
      }
      // No entry: repeat the shown amount (like an adding machine's repeat add).
      const v = typed ?? s.shown;
      const acc = apply(s.acc, key, v);
      return {
        ...s,
        entry: "",
        acc,
        shown: acc,
        tape: [...s.tape, line(s, { op: key, value: v })],
      };
    }
    case "*":
    case "/": {
      const v = typed ?? s.shown;
      const op = key === "*" ? "×" : "÷";
      return {
        ...s,
        entry: "",
        pending: { op, value: v },
        shown: v,
        tape: [...s.tape, line(s, { op, value: v })],
      };
    }
    case "=": {
      if (!s.pending || typed === null) return s;
      const r = apply(s.pending.value, s.pending.op, typed);
      // The result waits to be added with + (adding-machine behaviour).
      return {
        ...s,
        entry: Number.isFinite(r) ? String(r) : "",
        pending: null,
        shown: r,
        tape: [
          ...s.tape,
          line(s, { op: "=", value: typed }),
          line(s, { op: "#", value: r, note: "result" }),
        ],
      };
    }
    case "S":
      return {
        ...s,
        entry: "",
        shown: s.acc,
        tape: [...s.tape, line(s, { op: "S", value: s.acc })],
      };
    case "T":
      return {
        ...s,
        entry: "",
        acc: 0,
        gt: tidy(s.gt + s.acc),
        shown: s.acc,
        tape: [...s.tape, line(s, { op: "T", value: s.acc })],
      };
    default:
      return s;
  }
}

function standard(s: CalcState, key: CalcKey, cfg: CalcSettings): CalcState {
  const typed = entryValue(s, cfg);
  const op = key === "+" ? "+" : key === "-" ? "-" : key === "*" ? "×" : key === "/" ? "÷" : null;
  const waiting = s.pending?.op ?? s.pendingAdd;
  if (op) {
    if (typed === null) {
      // Changing the operator before the second number.
      return op === "×" || op === "÷"
        ? { ...s, pending: { op, value: s.shown }, pendingAdd: null }
        : { ...s, pending: null, pendingAdd: op };
    }
    const acc = waiting ? apply(s.acc, waiting, typed) : typed;
    return {
      ...s,
      entry: "",
      acc,
      shown: acc,
      pending: op === "×" || op === "÷" ? { op, value: acc } : null,
      pendingAdd: op === "+" || op === "-" ? op : null,
      tape: [...s.tape, line(s, { op: waiting ?? "", value: typed })],
    };
  }
  if (key === "=" || key === "T") {
    if (!waiting || typed === null) return s;
    const r = apply(s.acc, waiting, typed);
    return {
      ...EMPTY_CALC,
      mem: s.mem,
      sec: s.sec,
      gt: key === "T" ? tidy(s.gt + r) : s.gt,
      shown: r,
      tape: [...s.tape, line(s, { op: waiting, value: typed }), line(s, { op: "=", value: r })],
    };
  }
  return s;
}

/** An amount from the page (click a number): 10-key adds or subtracts it at once;
 * standard types it in. */
export function sendAmount(
  s: CalcState,
  v: number,
  subtract: boolean,
  cfg: CalcSettings,
): CalcState {
  if (cfg.mode === "tenKey") {
    const acc = apply(s.acc, subtract ? "-" : "+", v);
    return {
      ...s,
      entry: "",
      acc,
      shown: acc,
      tape: [...s.tape, line(s, { op: subtract ? "-" : "+", value: v })],
    };
  }
  // Typed in as if keyed (no implied decimals).
  return { ...s, entry: String(subtract ? -v : v), shown: v };
}

/** Display text. */
export function display(s: CalcState, cfg: CalcSettings): string {
  if (s.entry) return s.entry;
  return Number.isFinite(s.shown) ? formatAmount(s.shown, cfg.decimals) : "Error";
}

export interface FootResult {
  count: number;
  sum: number;
  /** The total it was compared to, or null. */
  total: number | null;
  /** total - sum, or null. */
  variance: number | null;
  /** A row (cross-foot) rather than a column (foot). */
  across: boolean;
}

export function foot(values: number[], total: number | null, across: boolean): FootResult {
  const sum = tidy(values.reduce((a, b) => a + b, 0));
  return {
    count: values.length,
    sum,
    total,
    variance: total === null ? null : tidy(total - sum),
    across,
  };
}

/** The footing as tape lines: each amount, the sum, and the comparison. */
export function footTape(values: number[], r: FootResult): TapeLine[] {
  const lines: TapeLine[] = values.map((v) => ({ op: "+", value: v }));
  lines.push({ op: "T", value: r.sum, note: r.across ? "cross-foot" : "foot" });
  if (r.total !== null && r.variance !== null) {
    lines.push({ op: "#", value: r.total, note: "total on page" });
    lines.push({ op: "#", value: r.variance, note: r.variance === 0 ? "agrees" : "variance" });
  }
  return lines;
}
