// The look of a visible certificate signature: a form XObject the size of the box, in
// the page's displayed orientation. Left half: the signature image when there is one,
// otherwise the signer's name in large type; right half: "Digitally signed by",
// date, reason, location. Helvetica (a standard font, WinAnsi; other characters print
// as "?").

import { Encodings, Font, FontNames } from "@pdf-lib/standard-fonts";
import { pdfNumber } from "./incremental";
import type { Rgba } from "../pages/png";

const helvetica = Font.load(FontNames.Helvetica);

function code(c: string): number {
  try {
    return Encodings.WinAnsi.encodeUnicodeCodePoint(c.codePointAt(0) ?? 63).code;
  } catch {
    return 63;
  }
}

/** Width of `s` in Helvetica at size 1. */
function widthOf(s: string): number {
  let w = 0;
  for (const c of s) {
    try {
      const g = Encodings.WinAnsi.encodeUnicodeCodePoint(c.codePointAt(0) ?? 63).name;
      w += helvetica.getWidthOfGlyph(g) ?? 556;
    } catch {
      w += helvetica.getWidthOfGlyph("question") ?? 556;
    }
  }
  return w / 1000;
}

const hexText = (s: string) =>
  `<${Array.from(s, (c) => code(c).toString(16).padStart(2, "0")).join("")}>`;

export interface AppearanceInput {
  width: number;
  height: number;
  name: string;
  /** Lines shown on the right: "Digitally signed by ...", "Date: ...", ... */
  details: string[];
  image?: Rgba | null;
}

export interface Appearance {
  content: string;
  /** Present when the content draws /Img0. */
  image: Rgba | null;
}

/** Content stream for the box (font resource /Helv, image resource /Img0). */
export function signatureAppearance(a: AppearanceInput): Appearance {
  const pad = Math.min(a.width, a.height) * 0.06;
  const half = a.width / 2;
  let ops = "";

  if (a.image && a.image.width > 0 && a.image.height > 0) {
    const bw = half - pad * 2;
    const bh = a.height - pad * 2;
    const k = Math.min(bw / a.image.width, bh / a.image.height);
    const w = a.image.width * k;
    const h = a.image.height * k;
    const x = pad + (bw - w) / 2;
    const y = pad + (bh - h) / 2;
    ops += `q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y)} cm /Img0 Do Q\n`;
  } else if (a.name) {
    const size = Math.min((half - pad * 2) / Math.max(widthOf(a.name), 0.01), a.height * 0.5);
    const y = (a.height - size * 0.7) / 2;
    ops += `BT /Helv ${n(size)} Tf ${n(pad)} ${n(y)} Td ${hexText(a.name)} Tj ET\n`;
  }

  const lines = a.details.filter((l) => l);
  if (lines.length) {
    const avail = a.width - half - pad;
    const widest = Math.max(...lines.map(widthOf), 0.01);
    const size = Math.max(
      3,
      Math.min(avail / widest, (a.height - pad * 2) / (lines.length * 1.2), 12),
    );
    const lead = size * 1.2;
    const top = a.height / 2 + (lead * lines.length) / 2 - size;
    ops += `BT /Helv ${n(size)} Tf ${n(lead)} TL ${n(half)} ${n(top)} Td\n`;
    lines.forEach((l, i) => {
      ops += `${i ? "T* " : ""}${hexText(l)} Tj\n`;
    });
    ops += "ET\n";
  }
  return { content: ops, image: a.image ?? null };
}

const n = pdfNumber;

/** "2026.10.31 14:05:09 -07'00'" (how Acrobat shows signing times). */
export function displayDate(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${zone(d, "'")}'`
  );
}

/** PDF date "D:20261031140509-07'00'". */
export function pdfDate(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${zone(d, "'")}'`
  );
}

function zone(d: Date, sep: string): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}${sep}${String(a % 60).padStart(2, "0")}`;
}
