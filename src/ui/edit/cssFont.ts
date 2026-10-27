// Edit PDF (B3): the closest browser font for a PDF font, used while typing. The exact
// result (the PDF's own font, or the chosen font file) appears when the edit commits;
// PDF subset fonts can't be loaded as browser fonts (no cmap/name tables).
import { parsePdfFontName } from "../../engine/edit/fonts";

const KNOWN: [RegExp, string][] = [
  [/^(helvetica|arial|liberationsans)/i, "Arial, Helvetica, 'Liberation Sans', sans-serif"],
  [/^(times|liberationserif)/i, "'Times New Roman', Times, 'Liberation Serif', serif"],
  [/^(courier|liberationmono)/i, "'Courier New', Courier, 'Liberation Mono', monospace"],
  [/^calibri|^carlito/i, "Calibri, Carlito, sans-serif"],
  [/^cambria|^caladea/i, "Cambria, Caladea, serif"],
];

/** "TimesNewRoman" -> "Times New Roman". */
const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2");

export function cssFont(pdfFontName: string): {
  family: string;
  weight: number;
  style: "normal" | "italic";
} {
  const f = parsePdfFontName(pdfFontName);
  const known = KNOWN.find(([re]) => re.test(f.family))?.[1];
  const generic = /mono|courier|consol/i.test(f.family)
    ? "monospace"
    : /times|serif|roman|georgia|garamond|cambria|book|palatino|century/i.test(f.family)
      ? "serif"
      : "sans-serif";
  return {
    family: known ?? `'${spaced(f.family)}', ${generic}`,
    weight: f.bold ? 700 : 400,
    style: f.italic ? "italic" : "normal",
  };
}
