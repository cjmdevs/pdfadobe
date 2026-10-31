// The Signatures panel's data: every signature in a file, whether its bytes still match
// what was signed, and whether the file changed after it. No trust validation (v1):
// the certificate is shown, not checked against a trust list.
//
// A signature dictionary's /Contents must sit in the file as written (its /ByteRange
// points at it), so signatures are found by scanning the bytes for /ByteRange.

import * as pkijs from "pkijs";
import { certName } from "./cms";

export interface SignatureInfo {
  /** 1-based, in file order (earliest first). */
  index: number;
  signer: string;
  /** "D:2026..." as written in /M, or null. */
  time: string | null;
  reason: string | null;
  location: string | null;
  subFilter: string | null;
  /** The signed bytes still match the signature (message digest and signature value). */
  intact: boolean;
  /** Bytes were added after this signature (later changes, another signature included). */
  changedAfter: boolean;
  /** Byte length of the signed revision (for "view signed version"). */
  revisionLength: number;
  /** Why the check failed, in plain words. */
  problem: string | null;
}

const latin1 = new TextDecoder("latin1");

export async function listSignatures(bytes: Uint8Array): Promise<SignatureInfo[]> {
  const text = latin1.decode(bytes);
  const out: SignatureInfo[] = [];
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let end = bytes.length;
  while (end > 0 && /\s/.test(String.fromCharCode(bytes[end - 1] ?? 0))) end--;
  for (const m of text.matchAll(re)) {
    const [a, b, c, d] = m.slice(1, 5).map(Number) as [number, number, number, number];
    if (a !== 0 || b >= c || c + d > bytes.length) continue;
    if (bytes[b] !== 0x3c || bytes[c - 1] !== 0x3e) continue;
    const dict = dictAround(text, m.index ?? 0);
    const info: SignatureInfo = {
      index: out.length + 1,
      signer: "",
      time: stringEntry(dict, "M"),
      reason: stringEntry(dict, "Reason"),
      location: stringEntry(dict, "Location"),
      subFilter: /\/SubFilter\s*\/([^\s/<>[\]()]+)/.exec(dict)?.[1] ?? null,
      intact: false,
      changedAfter: c + d < end,
      revisionLength: c + d,
      problem: null,
    };
    try {
      const der = hexBytes(text.slice(b + 1, c - 1));
      const signed = new Uint8Array(b + d);
      signed.set(bytes.subarray(0, b));
      signed.set(bytes.subarray(c, c + d), b);
      const content = pkijs.ContentInfo.fromBER(trimDer(der));
      const sd = new pkijs.SignedData({ schema: content.content });
      const cert = sd.certificates?.find(
        (x): x is pkijs.Certificate => x instanceof pkijs.Certificate,
      );
      const sid = sd.signerInfos[0]?.sid;
      const mine =
        sid instanceof pkijs.IssuerAndSerialNumber
          ? sd.certificates?.find(
              (x): x is pkijs.Certificate =>
                x instanceof pkijs.Certificate && x.serialNumber.isEqual(sid.serialNumber),
            )
          : undefined;
      info.signer = certName(mine ?? cert ?? new pkijs.Certificate()) || "Unknown signer";
      info.intact = await sd.verify({
        signer: 0,
        data: signed.buffer as ArrayBuffer,
        checkChain: false,
      });
      if (!info.intact) info.problem = "The signed content does not match the signature.";
    } catch {
      info.signer ||= stringEntry(dict, "Name") ?? "Unknown signer";
      info.problem = "The signature does not match the signed content, or could not be read.";
    }
    out.push(info);
  }
  return out
    .sort((x, y) => x.revisionLength - y.revisionLength)
    .map((s, i) => ({ ...s, index: i + 1 }));
}

/** The text of the dictionary holding position `at` (from "<<" to its ">>"). */
function dictAround(text: string, at: number): string {
  const startObj = text.lastIndexOf(" obj", at);
  const endObj = text.indexOf("endobj", at);
  return text.slice(Math.max(0, startObj), endObj < 0 ? at + 4096 : endObj);
}

/** A string entry (/Key (...) or /Key <...>) of a dictionary's text. */
export function stringEntry(dict: string, key: string): string | null {
  const re = new RegExp(`/${key}\\s*([(<])`);
  const m = re.exec(dict);
  if (!m || m.index === undefined) return null;
  let i = m.index + m[0].length;
  if (m[1] === "<") {
    const close = dict.indexOf(">", i);
    return decodeText(hexBytes(dict.slice(i, close)));
  }
  let depth = 1;
  const bytes: number[] = [];
  while (i < dict.length && depth > 0) {
    const ch = dict[i++] ?? "";
    if (ch === "\\") {
      const nx = dict[i++] ?? "";
      const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
      const e = esc[nx];
      if (e !== undefined) bytes.push(e);
      else if (/[0-7]/.test(nx)) {
        let oct = nx;
        while (oct.length < 3 && /[0-7]/.test(dict[i] ?? "")) oct += dict[i++];
        bytes.push(parseInt(oct, 8) & 255);
      } else if (nx === "\r" || nx === "\n") {
        if (nx === "\r" && dict[i] === "\n") i++;
      } else bytes.push(nx.charCodeAt(0));
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")" && --depth === 0) break;
    bytes.push(ch.charCodeAt(0));
  }
  return decodeText(Uint8Array.from(bytes));
}

function decodeText(b: Uint8Array): string {
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
    return new TextDecoder().decode(b.subarray(3));
  return latin1.decode(b);
}

function hexBytes(h: string): Uint8Array {
  const clean = h.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The DER object at the start of `b`, without the zero padding after it. */
function trimDer(b: Uint8Array): ArrayBuffer {
  let len = b.length;
  if (b[0] === 0x30 && b[1] !== undefined) {
    const first = b[1];
    if (first < 0x80) len = 2 + first;
    else {
      const n = first & 0x7f;
      let l = 0;
      for (let i = 0; i < n; i++) l = l * 256 + (b[2 + i] ?? 0);
      len = n ? 2 + n + l : b.length;
    }
  }
  const s = b.subarray(0, Math.min(len, b.length));
  return s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength) as ArrayBuffer;
}
