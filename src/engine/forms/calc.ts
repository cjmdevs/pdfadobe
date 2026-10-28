// Calculated fields (Phase 6). Our PDFium has no JavaScript engine (docs/forms-spike-
// report.md), so the calculations Acrobat's form tools write are recognised and run
// here, without eval:
//   - AFSimple_Calculate("SUM" | "PRD" | "AVG" | "MIN" | "MAX", fields)
//   - simplified field notation: /** BVCALC Total - Deduction EVCALC **/
// Any other calculation script is a custom one: left alone and reported, so the user
// knows that field is calculated in Acrobat only. Fields run in the /CO order, once per
// change, like Acrobat. Plain data in, plain data out (tested without PDFium).

import type { FieldFormat } from "./design";
import type { FieldValues } from "./fill";

export type Calc =
  | { kind: "simple"; op: "SUM" | "PRD" | "AVG" | "MIN" | "MAX"; fields: string[] }
  | { kind: "sfn"; expr: Expr }
  | { kind: "custom" };

export interface CalcSetup {
  /** Calculated fields in the order they run (/CO first, then the rest). */
  order: string[];
  calcs: Record<string, Calc>;
  /** Number formats (AFNumber_Format) by field name. */
  formats: Record<string, Extract<FieldFormat, { kind: "number" }>>;
  /** Max length of number-formatted fields that have one. */
  maxLens?: Record<string, number>;
  /** Every field name, for group names ("Line" sums "Line.0", "Line.1"...). */
  names: string[];
}

// ---- Parsing ---------------------------------------------------------------------------

const SIMPLE =
  /AFSimple_Calculate\s*\(\s*["'](SUM|PRD|AVG|MIN|MAX)["']\s*,\s*([\s\S]*?)\)\s*;?\s*$/;

/** The calculation a /AA /C script describes. */
export function parseCalc(script: string): Calc {
  const sfn = /\/\*\*\s*BVCALC([\s\S]*?)EVCALC\s*\*\*\//.exec(script);
  if (sfn) {
    try {
      return { kind: "sfn", expr: parseExpr(sfn[1] ?? "") };
    } catch {
      return { kind: "custom" };
    }
  }
  const m = SIMPLE.exec(script.trim());
  if (m) {
    const list = m[2] ?? "";
    // new Array("A", "B")  or  "A, B"
    const quoted = [...list.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map((q) =>
      (q[1] ?? q[2] ?? "").replace(/\\(.)/g, "$1"),
    );
    const fields = /^\s*new\s+Array/.test(list)
      ? quoted
      : quoted
          .flatMap((q) => q.split(","))
          .map((s) => s.trim())
          .filter(Boolean);
    if (fields.length) return { kind: "simple", op: m[1] as "SUM", fields };
  }
  return { kind: "custom" };
}

export type Expr =
  | { t: "num"; v: number }
  | { t: "field"; name: string }
  | { t: "neg"; e: Expr }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; a: Expr; b: Expr };

/** Simplified field notation: + - * / ( ), numbers, field names (\ escapes a character). */
export function parseExpr(src: string): Expr {
  const tokens: (string | { name: string } | { num: number })[] = [];
  for (let i = 0; i < src.length;) {
    const c = src.charAt(i);
    if (/\s/.test(c)) {
      i++;
    } else if ("+-*/()".includes(c)) {
      tokens.push(c);
      i++;
    } else if (/[0-9.]/.test(c) && !/[A-Za-z_]/.test(src.charAt(i + 1) || " ")) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) throw new Error("bad number");
      tokens.push({ num: Number(m[1]) });
      i += m[1]?.length ?? 1;
    } else {
      let name = "";
      while (i < src.length) {
        const ch = src.charAt(i);
        if (ch === "\\" && i + 1 < src.length) {
          name += src.charAt(i + 1);
          i += 2;
        } else if (/\s/.test(ch) || "+-*/()".includes(ch)) break;
        else {
          name += ch;
          i++;
        }
      }
      tokens.push({ name });
    }
  }
  let k = 0;
  const peek = () => tokens[k];
  const expr = (): Expr => {
    let a = term();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[k++] as "+" | "-";
      a = { t: "bin", op, a, b: term() };
    }
    return a;
  };
  const term = (): Expr => {
    let a = unary();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[k++] as "*" | "/";
      a = { t: "bin", op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Expr => {
    if (peek() === "-") {
      k++;
      return { t: "neg", e: unary() };
    }
    if (peek() === "+") {
      k++;
      return unary();
    }
    return atom();
  };
  const atom = (): Expr => {
    const tok = tokens[k++];
    if (tok === "(") {
      const e = expr();
      if (tokens[k++] !== ")") throw new Error("missing )");
      return e;
    }
    if (tok && typeof tok === "object" && "num" in tok) return { t: "num", v: tok.num };
    if (tok && typeof tok === "object" && "name" in tok && tok.name)
      return { t: "field", name: tok.name };
    throw new Error("bad formula");
  };
  const e = expr();
  if (k !== tokens.length) throw new Error("bad formula");
  return e;
}

// ---- Numbers ----------------------------------------------------------------------------

type NumberFormat = Extract<FieldFormat, { kind: "number" }>;

/** A field's text as a number the way Acrobat reads it (AFMakeNumber): empty = 0. */
export function toNumber(text: string, f?: NumberFormat): number {
  let s = text.trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^\d.,()-]/g, ""));
  const decimalComma = f && (f.sep === 2 || f.sep === 3);
  s = s.replace(/[^\d.,]/g, "");
  s = decimalComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

/** Rounds half away from zero to `d` decimals, without binary surprises (1.005 -> 1.01). */
export function round(n: number, d: number): number {
  const sign = n < 0 ? -1 : 1;
  return sign * Number(`${Math.round(Number(`${Math.abs(n)}e${d}`))}e-${d}`);
}

/** The display text AFNumber_Format gives `n` (red styles show as minus / parentheses). */
export function formatNumber(n: number, f: NumberFormat): string {
  const r = round(n, f.decimals);
  const [int = "0", frac = ""] = Math.abs(r).toFixed(f.decimals).split(".");
  const thousands = f.sep === 0 ? "," : f.sep === 2 ? "." : "";
  const point = f.sep === 2 || f.sep === 3 ? "," : ".";
  const grouped = thousands ? int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands) : int;
  let body = frac ? `${grouped}${point}${frac}` : grouped;
  if (f.currency) body = `${f.currency}${body}`;
  if (r >= 0) return body;
  return f.negative === 2 || f.negative === 3 ? `(${body})` : `-${body}`;
}

/** What a calculated number is stored as in /V: plain, like Acrobat ("1234.5"). */
export function rawNumber(n: number, f?: NumberFormat): string {
  if (!Number.isFinite(n)) return "";
  return String(f ? round(n, f.decimals) : round(n, 10));
}

// ---- Running ----------------------------------------------------------------------------

/** Field names a reference covers: itself, or every field under it ("Line" -> "Line.0"). */
function expand(ref: string, names: string[]): string[] {
  if (names.includes(ref)) return [ref];
  return names.filter((n) => n.startsWith(`${ref}.`));
}

function evaluate(e: Expr, get: (name: string) => number): number {
  switch (e.t) {
    case "num":
      return e.v;
    case "field":
      return get(e.name);
    case "neg":
      return -evaluate(e.e, get);
    case "bin": {
      const a = evaluate(e.a, get);
      const b = evaluate(e.b, get);
      return e.op === "+" ? a + b : e.op === "-" ? a - b : e.op === "*" ? a * b : a / b;
    }
  }
}

/**
 * Runs every calculation once, in order, on `values` (field name -> text). Returns the
 * new raw values of the calculated fields that changed. Custom ones are not touched.
 */
export function recalculate(setup: CalcSetup, values: FieldValues): FieldValues {
  const current = { ...values };
  const changed: FieldValues = {};
  const num = (name: string) =>
    expand(name, setup.names).reduce((s, n) => s + toNumber(current[n] ?? "", setup.formats[n]), 0);
  for (const name of setup.order) {
    const c = setup.calcs[name];
    if (!c || c.kind === "custom") continue;
    let n: number;
    if (c.kind === "sfn") n = evaluate(c.expr, num);
    else {
      const parts = c.fields.flatMap((f) => expand(f, setup.names));
      const xs = parts.map((p) => toNumber(current[p] ?? "", setup.formats[p]));
      n =
        c.op === "SUM"
          ? xs.reduce((a, b) => a + b, 0)
          : c.op === "PRD"
            ? xs.reduce((a, b) => a * b, 1)
            : c.op === "AVG"
              ? xs.length
                ? xs.reduce((a, b) => a + b, 0) / xs.length
                : 0
              : xs.length
                ? (c.op === "MIN" ? Math.min : Math.max)(...xs)
                : 0;
    }
    const v = rawNumber(n, setup.formats[name]);
    if (v !== (current[name] ?? "")) {
      current[name] = v;
      changed[name] = v;
    }
  }
  return changed;
}

/** Fields whose calculation is a custom script (run by Acrobat only). */
export const customCalcs = (setup: CalcSetup) =>
  setup.order.filter((n) => setup.calcs[n]?.kind === "custom");
