// Edit PDF (B3 stage 2): the content-stream pass. PDFium can't set character spacing,
// word spacing or kerning on a text object (no setters), but it keeps them once they
// are in the content stream (checked: Tc, Tw and TJ arrays survive later edits of the
// page). So after PDFium saves, the text objects we wrote that need spacing (their
// `/PWBox` mark carries /Tc, /N and /K, see `marks.ts`) get it written here:
//
//   /PWBox <</id 3 /Tc .5 /N 5 /K (1:-40)>> BDC ... <0024004500460047> Tj ... EMC
//   -> /PWBox <</id 3>> BDC ... .5 Tc [<00240045> -40 <00460047>] TJ ... EMC
//
// Only those page content streams change (qpdf --update-from-json). A stream with an
// inline image is left alone (its binary data can't be scanned safely): the text then
// keeps PDFium's plain spacing, and the marks keep their keys.

import { runToFile, type Qpdf } from "../pages/qpdf";
import { isRef, PdfObjects, withKey, type JDict, type JVal } from "../redact/objects";

/** Writes the pending spacing of our text on `pages` (0-based). */
export async function applySpacing(
  qpdf: Qpdf,
  bytes: Uint8Array,
  pages: number[],
): Promise<Uint8Array> {
  const objs = await PdfObjects.read(qpdf, bytes);
  const refs = pages.flatMap((i) => {
    const page = objs.dict(objs.pages()[i]);
    const c = page?.["/Contents"];
    const list = isRef(c) ? [objs.get(c)] : [c];
    // /Contents is one stream or an array of them.
    return (Array.isArray(list[0]) ? (list[0] as JVal[]) : [c]).filter(isRef);
  });
  if (!refs.length) return bytes;
  const data = await streamData(qpdf, bytes, refs);
  for (const ref of refs) {
    const raw = data.get(ref);
    const dict = objs.dict(ref);
    if (!raw || !dict) continue;
    const out = patchContent(raw);
    if (out === null) continue;
    let d: JDict = dict;
    for (const k of ["/Filter", "/DecodeParms", "/Length"]) d = withKey(d, k, undefined);
    objs.setStream(ref, d, out);
  }
  if (!objs.hasChanges) return bytes;
  return runToFile(qpdf, {
    inputs: { "in0.pdf": bytes, "edit.json": new TextEncoder().encode(objs.updateJson()) },
    args: ["in0.pdf", "--update-from-json=edit.json", "out.pdf"],
    outputs: ["out.pdf"],
  });
}

/** Decoded data of the streams `refs` ("12 0 R"). */
async function streamData(
  qpdf: Qpdf,
  bytes: Uint8Array,
  refs: string[],
): Promise<Map<string, Uint8Array>> {
  const r = await qpdf.run({
    inputs: { "in0.pdf": bytes },
    args: [
      "--json=2",
      "--json-key=qpdf",
      "--json-stream-data=inline",
      "--decode-level=generalized",
      ...refs.map((ref) => `--json-object=${ref.replace(/ 0 R$/, "").replace(/ (\d+) R$/, ",$1")}`),
      "in0.pdf",
    ],
    outputs: [],
  });
  const parsed = JSON.parse(r.stdout) as {
    qpdf: [JVal, Record<string, { stream?: { data?: string } }>];
  };
  const out = new Map<string, Uint8Array>();
  for (const ref of refs) {
    const b64 = parsed.qpdf[1][`obj:${ref}`]?.stream?.data;
    if (!b64) continue;
    const bin = atob(b64);
    out.set(
      ref,
      Uint8Array.from(bin, (c) => c.charCodeAt(0)),
    );
  }
  return out;
}

interface Tok {
  kind: "num" | "name" | "str" | "hex" | "dict" | "arr" | "op";
  start: number;
  end: number;
  text: string;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([..."()<>[]{}/%"].map((c) => c.charCodeAt(0)));

/** Content-stream tokens (dicts and arrays as one token each). Null on an inline image. */
function tokenize(s: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  const n = s.length;
  const code = (k: number) => s.charCodeAt(k);
  const skipString = (k: number): number => {
    let depth = 0;
    for (; k < n; k++) {
      const c = s[k];
      if (c === "\\") k++;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return k + 1;
    }
    return n;
  };
  /** End of a balanced << >> or [ ] starting at k. */
  const skipNested = (k: number): number => {
    let depth = 0;
    while (k < n) {
      const c = s[k];
      if (c === "(") {
        k = skipString(k);
        continue;
      }
      if (c === "<" && s[k + 1] === "<") {
        depth++;
        k += 2;
      } else if (c === ">" && s[k + 1] === ">") {
        depth--;
        k += 2;
      } else if (c === "[") {
        depth++;
        k++;
      } else if (c === "]") {
        depth--;
        k++;
      } else if (c === "<") {
        k = s.indexOf(">", k) + 1 || n;
      } else k++;
      if (depth === 0) return k;
    }
    return n;
  };
  while (i < n) {
    const c = code(i);
    if (WS.has(c)) {
      i++;
      continue;
    }
    if (s[i] === "%") {
      while (i < n && s[i] !== "\n" && s[i] !== "\r") i++;
      continue;
    }
    const start = i;
    let kind: Tok["kind"];
    if (s[i] === "(") {
      i = skipString(i);
      kind = "str";
    } else if (s.startsWith("<<", i)) {
      i = skipNested(i);
      kind = "dict";
    } else if (s[i] === "<") {
      i = s.indexOf(">", i) + 1 || n;
      kind = "hex";
    } else if (s[i] === "[") {
      i = skipNested(i);
      kind = "arr";
    } else if (s[i] === "/") {
      i++;
      while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
      kind = "name";
    } else {
      while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
      if (i === start) i++;
      kind = /^[-+.\d]/.test(s[start] ?? "") ? "num" : "op";
    }
    const text = s.slice(start, i);
    if (kind === "op" && text === "BI") return null;
    out.push({ kind, start, end: i, text });
  }
  return out;
}

/** A PDF string token's bytes. */
function stringBytes(t: Tok): number[] {
  if (t.kind === "hex") {
    let h = t.text.slice(1, -1).replace(/\s+/g, "");
    if (h.length % 2) h += "0";
    return Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
  }
  const s = t.text.slice(1, -1);
  const out: number[] = [];
  const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? "";
    if (c !== "\\") {
      out.push(c.charCodeAt(0));
      continue;
    }
    const d = s[++i] ?? "";
    if (d in esc) out.push(esc[d] ?? 0);
    else if (/[0-7]/.test(d)) {
      let oct = d;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? "")) oct += s[++i];
      out.push(parseInt(oct, 8) & 0xff);
    } else if (d === "\r") {
      if (s[i + 1] === "\n") i++;
    } else if (d !== "\n") out.push(d.charCodeAt(0));
  }
  return out;
}

const hex = (b: number[]) => `<${b.map((x) => x.toString(16).padStart(2, "0")).join("")}>`;

/**
 * Writes the spacing our marks ask for. Returns the new content, or null when there
 * was nothing to do (or the stream can't be scanned).
 */
export function patchContent(data: Uint8Array): Uint8Array | null {
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  const toks = tokenize(s);
  if (!toks) return null;
  const edits: { start: number; end: number; text: string }[] = [];
  /** Open marked sections: the spacing ours ask for (null for others). */
  const open: ({ tc: number; n: number; k: Map<number, number> } | null)[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t || t.kind !== "op") continue;
    if (t.text === "BDC" || t.text === "BMC") {
      const tag = toks[i - (t.text === "BDC" ? 2 : 1)];
      const props = t.text === "BDC" ? toks[i - 1] : undefined;
      const want = tag?.text === "/PWBox" && props?.kind === "dict" ? spacingIn(props.text) : null;
      open.push(want);
      if (want && props)
        edits.push({ start: props.start, end: props.end, text: plainDict(props.text) });
    } else if (t.text === "EMC") open.pop();
    else if (t.text === "Tj" || t.text === "'" || t.text === '"') {
      // The innermost of our sections asking for spacing.
      const want = [...open].reverse().find((o) => o !== null) ?? null;
      const str = toks[i - 1];
      if (!want || t.text !== "Tj" || !str || (str.kind !== "str" && str.kind !== "hex")) continue;
      const bytes = stringBytes(str);
      const w = bytes.length / want.n;
      // One or two bytes per letter, or leave it (spacing lost, text kept).
      if (w !== 1 && w !== 2) continue;
      const parts: string[] = [];
      let cur: number[] = [];
      for (let k = 0; k < want.n; k++) {
        cur.push(...bytes.slice(k * w, k * w + w));
        const adj = want.k.get(k);
        if (adj !== undefined && k < want.n - 1) {
          parts.push(hex(cur), String(adj));
          cur = [];
        }
      }
      if (cur.length) parts.push(hex(cur));
      edits.push({
        start: str.start,
        end: t.end,
        text: `${fmt(want.tc)} Tc [${parts.join(" ")}] TJ`,
      });
    }
  }
  if (!edits.length) return null;
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) s = s.slice(0, e.start) + e.text + s.slice(e.end);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const fmt = (v: number) => String(Math.round(v * 10000) / 10000);

/** The spacing keys of a `/PWBox` properties dict, or null without them. */
function spacingIn(dict: string): { tc: number; n: number; k: Map<number, number> } | null {
  const n = /\/N\s+(\d+)/.exec(dict);
  if (!n) return null;
  const tc = Number(/\/Tc\s+([-+.\d]+)/.exec(dict)?.[1] ?? 0);
  const k = new Map<number, number>();
  for (const pair of (/\/K\s*\(([^)]*)\)/.exec(dict)?.[1] ?? "").split(",")) {
    const [a, b] = pair.split(":");
    if (a && b) k.set(Number(a), Number(b));
  }
  return { tc: Number.isFinite(tc) ? tc : 0, n: Number(n[1]), k };
}

/** The dict without our spacing keys (written once; later saves keep PDFium's copy). */
function plainDict(dict: string): string {
  return dict
    .replace(/\/Tc\s+[-+.\d]+/, "")
    .replace(/\/N\s+\d+/, "")
    .replace(/\/K\s*\([^)]*\)/, "");
}
