// Calculated fields in a file (Phase 6): read the setup (calculation scripts, /CO order,
// number formats), fill and recalculate, and store number values the way Acrobat does:
// the appearance shows the formatted text ("$1,234.50"), /V holds the plain number
// ("1234.5"). Acrobat reads /V back with AFMakeNumber, which misreads "1,234.50".
// Node-safe.

import type { PagesCtx } from "../pages";
import { runToFile } from "../pages/qpdf";
import { PdfObjects, isRef, withKey, type JVal } from "../redact/objects";
import { parseCalc, formatNumber, rawNumber, recalculate, toNumber, type CalcSetup } from "./calc";
import { parseFormat } from "./design";
import { fillForm, formValues, type FieldValues, type FillReport } from "./fill";
import { terminalFields } from "./reset";

/** Script text of an action's /JS: a string, or a stream (read separately). */
async function scriptsOf(
  ctx: PagesCtx,
  bytes: Uint8Array,
  objs: PdfObjects,
  actions: Map<string, JVal | undefined>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const streams = new Map<string, string>();
  for (const [key, action] of actions) {
    const js = objs.dict(action)?.["/JS"];
    if (typeof js !== "string") continue;
    // isRef narrows to "not a string" in the else branch, so test the shape directly.
    if (/^\d+ \d+ R$/.test(js)) streams.set(key, js);
    else out.set(key, js.replace(/^u:|^b:/, ""));
  }
  if (streams.size) {
    const refs = [...new Set(streams.values())];
    const r = await ctx.qpdf.run({
      inputs: { "in0.pdf": bytes },
      args: [
        "--json=2",
        "--json-key=qpdf",
        "--json-stream-data=inline",
        "--decode-level=generalized",
        ...refs.map((ref) => `--json-object=${ref.replace(" R", "").replace(" ", ",")}`),
        "in0.pdf",
      ],
      outputs: [],
    });
    const parsed = JSON.parse(r.stdout) as {
      qpdf: [unknown, Record<string, { stream?: { data?: string } }>];
    };
    for (const [key, ref] of streams) {
      const data = parsed.qpdf[1][`obj:${ref}`]?.stream?.data;
      if (data)
        out.set(
          key,
          new TextDecoder("latin1").decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0))),
        );
    }
  }
  return out;
}

export async function readCalcSetup(ctx: PagesCtx, bytes: Uint8Array): Promise<CalcSetup> {
  const objs = await PdfObjects.read(ctx.qpdf, bytes);
  const fields = terminalFields(objs);
  const byRef = new Map<string, string>();
  const actions = new Map<string, JVal | undefined>();
  for (const [name, t] of fields) {
    byRef.set(t.ref, name);
    const aa = objs.dict(objs.dict(t.ref)?.["/AA"]);
    if (!aa) continue;
    if (aa["/C"]) actions.set(`C:${name}`, aa["/C"]);
    if (aa["/F"]) actions.set(`F:${name}`, aa["/F"]);
  }
  const scripts = await scriptsOf(ctx, bytes, objs, actions);
  const setup: CalcSetup = { order: [], calcs: {}, formats: {}, names: [...fields.keys()] };
  for (const [key, code] of scripts) {
    const name = key.slice(2);
    if (key.startsWith("C:")) setup.calcs[name] = parseCalc(code);
    else {
      const f = parseFormat(code);
      if (f.kind === "number") setup.formats[name] = f;
    }
  }
  const co = objs.get(objs.dict(objs.catalog["/AcroForm"])?.["/CO"]);
  const ordered = Array.isArray(co) ? co.map((r) => (isRef(r) ? byRef.get(r) : undefined)) : [];
  for (const n of ordered) if (n && setup.calcs[n] && !setup.order.includes(n)) setup.order.push(n);
  for (const n of Object.keys(setup.calcs)) if (!setup.order.includes(n)) setup.order.push(n);
  return setup;
}

export const hasCalcs = (s: CalcSetup) => s.order.length > 0 || Object.keys(s.formats).length > 0;

/** /V back to the plain number for every number-formatted field (appearances untouched). */
export async function rawNumberValues(
  ctx: PagesCtx,
  bytes: Uint8Array,
  setup: CalcSetup,
): Promise<Uint8Array> {
  const names = Object.keys(setup.formats);
  if (!names.length) return bytes;
  const objs = await PdfObjects.read(ctx.qpdf, bytes);
  const fields = terminalFields(objs);
  for (const name of names) {
    const t = fields.get(name);
    const d = t && objs.dict(t.ref);
    const v = d?.["/V"];
    if (!t || !d || typeof v !== "string") continue;
    // A reference here would be unusual; only literal text values are numbers to clean.
    if (/^\d+ \d+ R$/.test(v)) continue;
    const text = v.replace(/^u:|^b:/, "");
    if (!text.trim()) continue;
    const raw = rawNumber(toNumber(text, setup.formats[name]), setup.formats[name]);
    if (raw !== text) objs.set(t.ref, withKey(d, "/V", `u:${raw}`));
  }
  if (!objs.hasChanges) return bytes;
  return runToFile(ctx.qpdf, {
    inputs: { "in0.pdf": bytes, "edit.json": new TextEncoder().encode(objs.updateJson()) },
    args: ["in0.pdf", "--update-from-json=edit.json", "out.pdf"],
    outputs: ["out.pdf"],
  });
}

/** Display text for a value typed into a number field ("1234.5" -> "1,234.50"). */
export function displayValue(setup: CalcSetup, name: string, value: string): string {
  const f = setup.formats[name];
  if (!f || !value.trim()) return value;
  return formatNumber(toNumber(value, f), f);
}

/**
 * Fill, then run the calculations, then store numbers plainly under formatted
 * appearances. What import and Fill from CSV use.
 */
export async function fillAndCalculate(
  ctx: PagesCtx,
  bytes: Uint8Array,
  values: FieldValues,
): Promise<FillReport & { bytes: Uint8Array }> {
  const setup = await readCalcSetup(ctx, bytes);
  if (!hasCalcs(setup)) return fillForm(ctx.engine, bytes, values);
  const shown: FieldValues = {};
  for (const [k, v] of Object.entries(values)) shown[k] = displayValue(setup, k, v);
  const first = await fillForm(ctx.engine, bytes, shown);
  let out = first.bytes;
  const changed = recalculate(setup, await formValues(ctx.engine, out));
  if (Object.keys(changed).length) {
    const calc: FieldValues = {};
    for (const [k, v] of Object.entries(changed)) calc[k] = displayValue(setup, k, v);
    out = (await fillForm(ctx.engine, out, calc)).bytes;
  }
  return { ...first, bytes: await rawNumberValues(ctx, out, setup) };
}
