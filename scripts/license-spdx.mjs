// SPDX expression evaluation for scripts/license-check.mjs. Pure, unit-tested.

export const COPYLEFT =
  /^(A|L)?GPL|^SSPL|^EUPL|^OSL-|^CPAL|^RPL|^Sleepycat|^CC-BY-(NC-)?SA|^CC-BY-NC/i;

// ---- SPDX expression parsing ------------------------------------------------
// Grammar: or := and ("OR" and)* ; and := atom ("AND" atom)* ;
//          atom := "(" or ")" | ID ["WITH" ID]
// Legacy separators seen in crates.io ("MIT/Apache-2.0", "Apache-2.0 / MIT") mean OR.
function tokenize(expr) {
  return expr
    .replace(/\s*\/\s*/g, " OR ")
    .replace(/([()])/g, " $1 ")
    .trim()
    .split(/\s+/);
}

export function parse(expr) {
  const t = tokenize(expr);
  let i = 0;
  const peek = () => t[i];
  const next = () => t[i++];
  function or() {
    const parts = [and()];
    while (peek()?.toUpperCase() === "OR") {
      next();
      parts.push(and());
    }
    return parts.length === 1 ? parts[0] : { op: "OR", parts };
  }
  function and() {
    const parts = [atom()];
    while (peek()?.toUpperCase() === "AND") {
      next();
      parts.push(atom());
    }
    return parts.length === 1 ? parts[0] : { op: "AND", parts };
  }
  function atom() {
    const tok = next();
    if (tok === undefined) throw new Error("unexpected end");
    if (tok === "(") {
      const e = or();
      if (next() !== ")") throw new Error("missing )");
      return e;
    }
    if (peek()?.toUpperCase() === "WITH") {
      next();
      const exc = next();
      if (!exc) throw new Error("missing exception after WITH");
      return { id: `${tok} WITH ${exc}` };
    }
    return { id: tok };
  }
  const e = or();
  if (i !== t.length) throw new Error(`unexpected token ${t[i]}`);
  return e;
}

/**
 * Returns the licenses from `extras` used to satisfy the expression ([] if only
 * `allowed` ones were needed), or null if it can't be satisfied.
 */
export function satisfy(node, allowed, extras) {
  if (node.id) {
    const base = node.id.replace(/\+$/, "");
    if (COPYLEFT.test(base)) return null;
    if (allowed.has(base)) return [];
    if (extras.has(base)) return [base];
    return null;
  }
  if (node.op === "AND") {
    const used = [];
    for (const p of node.parts) {
      const u = satisfy(p, allowed, extras);
      if (u === null) return null;
      used.push(...u);
    }
    return used;
  }
  // OR: prefer a branch that needs no extras.
  let best = null;
  for (const p of node.parts) {
    const u = satisfy(p, allowed, extras);
    if (u !== null && (best === null || u.length < best.length)) best = u;
  }
  return best;
}
