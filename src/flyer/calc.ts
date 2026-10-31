// Calculator (Phase 4 stage 3): a 10-key adding machine and a standard calculator, both
// printing to a tape. Pure state in, state out; no React. Amounts are kept as numbers
// and rounded to cents for display and totals (no binary-fraction noise like 0.1+0.2).

export type CalcMode = "tenKey" | "standard";
/** Decimal places shown; "F" = as many as needed. */
export type CalcDecimals = 0 | 2 | "F";

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
    decimals: r.decimals === 0 || r.decimals === "F" ? r.decimals : 2,
    addMode: r.addMode === true,
    tapeColor:
      typeof r.tapeColor === "string" &&
      /^#[0-9a-f]{6}$/i.test(r.tapeColor) &&
      r.tapeColor.toUpperCase() !== OLD_TAPE_COLOR
        ? r.tapeColor
        : DEFAULT_CALC.tapeColor,
  };
}

/** "+" "-" add/subtract; "×" "÷" operands; "=" result; "T" total; "S" subtotal; "" a
 * first operand (standard); "#" a number printed but not added (a note). */
export type TapeOp = "+" | "-" | "×" | "÷" | "=" | "T" | "S" | "" | "#";

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
}

export const EMPTY_CALC: CalcState = {
  entry: "",
  acc: 0,
  pending: null,
  pendingAdd: null,
  shown: 0,
  tape: [],
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
  | "Backspace";

export function press(s: CalcState, key: CalcKey, cfg: CalcSettings): CalcState {
  if (/^\d+$/.test(key)) {
    if (s.entry.replace(/\D/g, "").length >= 15) return s;
    return { ...s, entry: s.entry === "0" ? key.replace(/^0+/, "") || "0" : s.entry + key };
  }
  if (key === ".") return s.entry.includes(".") ? s : { ...s, entry: (s.entry || "0") + "." };
  if (key === "Backspace") return { ...s, entry: s.entry.slice(0, -1) };
  if (key === "CE") return { ...s, entry: "" };
  if (key === "C") return { ...EMPTY_CALC, tape: s.tape };
  return cfg.mode === "tenKey" ? tenKey(s, key, cfg) : standard(s, key, cfg);
}

function tenKey(s: CalcState, key: CalcKey, cfg: CalcSettings): CalcState {
  const typed = entryValue(s, cfg);
  switch (key) {
    case "+":
    case "-": {
      // No entry: repeat the shown amount (like an adding machine's repeat add).
      const v = typed ?? s.shown;
      const acc = apply(s.acc, key, v);
      return { ...s, entry: "", acc, shown: acc, tape: [...s.tape, { op: key, value: v }] };
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
        tape: [...s.tape, { op, value: v }],
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
        tape: [...s.tape, { op: "=", value: typed }, { op: "#", value: r, note: "result" }],
      };
    }
    case "S":
      return { ...s, entry: "", shown: s.acc, tape: [...s.tape, { op: "S", value: s.acc }] };
    case "T":
      return {
        ...s,
        entry: "",
        acc: 0,
        shown: s.acc,
        tape: [...s.tape, { op: "T", value: s.acc }],
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
    const line: TapeLine = { op: waiting ?? "", value: typed };
    return {
      ...s,
      entry: "",
      acc,
      shown: acc,
      pending: op === "×" || op === "÷" ? { op, value: acc } : null,
      pendingAdd: op === "+" || op === "-" ? op : null,
      tape: [...s.tape, line],
    };
  }
  if (key === "=" || key === "T") {
    if (!waiting || typed === null) return s;
    const r = apply(s.acc, waiting, typed);
    return {
      ...EMPTY_CALC,
      shown: r,
      tape: [...s.tape, { op: waiting, value: typed }, { op: "=", value: r }],
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
      tape: [...s.tape, { op: subtract ? "-" : "+", value: v }],
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
