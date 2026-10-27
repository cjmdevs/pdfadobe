// Edit PDF (B3): the font picker's choices and what picking one means. Pure (no React,
// no platform): the panel passes in the page's fonts, the font index and a metrics
// reader.
//
// Sections, like the plan: fonts in this document, the firm's fonts, Windows fonts
// (the user's own installed fonts are listed with Windows). Picking a family plus the
// B / I toggles resolves to a concrete font for the engine, with warnings:
//   - letters the font doesn't have (the edit would be refused)
//   - substitution (a metric twin, or the closest installed font, replaces a font that
//     is only embedded in the PDF)
//   - embedding restrictions (OS/2 fsType) and fonts that can't be embedded at all
//   - bold / italic simulated because the family has no such face

import { findStyle, matchFont, parsePdfFontName, type IndexedFace } from "../../engine/edit/fonts";
import type { FaceMetrics } from "../../engine/edit/fonts/sfnt";
import type { PlainFont } from "../../engine/edit";

/**
 * "standard": Helvetica, Times and Courier, which every PDF reader has (not embedded);
 * the default for new text and common in tax software output.
 */
export type Section = "document" | "standard" | "firm" | "windows";

export interface FontOption {
  /** Unique key: "<section>:<family>". */
  key: string;
  section: Section;
  /** Family as shown ("Times New Roman", "Calibri"). */
  label: string;
  /** For document fonts: one of the PDF font names of this family (for matching). */
  pdfName?: string;
}

export interface Warning {
  /** "error": the edit would be refused; "info": it works, but differently. */
  level: "error" | "info";
  text: string;
}

export interface Resolved {
  /** null: this choice can't be used (see warnings). */
  font: PlainFont | null;
  /** What the engine writes, for the panel ("Arial", "Helvetica (not embedded)"). */
  writes: string;
  fakeBold: boolean;
  fakeItalic: boolean;
  warnings: Warning[];
}

const STANDARD: Record<string, [string, string, string, string]> = {
  // regular, bold, italic, bold italic
  helvetica: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
  times: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  courier: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"],
};
const standardFamily = (name: string) => {
  const f = parsePdfFontName(name)
    .family.toLowerCase()
    .replace(/[^a-z]/g, "");
  return f === "timesroman" ? "times" : f in STANDARD ? f : null;
};
/** "TimesNewRoman" -> "Times New Roman" (PDF names drop spaces). */
const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2");
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The picker's options: this page's PDF fonts, then firm, then Windows families. */
export function fontOptions(pageFontNames: string[], faces: IndexedFace[]): FontOption[] {
  const out: FontOption[] = [];
  const seen = new Set<string>();
  for (const name of pageFontNames) {
    const family = parsePdfFontName(name).family;
    const key = `document:${squash(family)}`;
    if (!family || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, section: "document", label: spaced(family), pdfName: name });
  }
  for (const [label, pdfName] of [
    ["Helvetica", "Helvetica"],
    ["Times", "Times-Roman"],
    ["Courier", "Courier"],
  ] as const) {
    const key = `standard:${squash(label)}`;
    const inDoc = out.some((o) => standardFamily(o.pdfName ?? "") === standardFamily(pdfName));
    if (!inDoc) out.push({ key, section: "standard", label, pdfName });
  }
  for (const section of ["firm", "windows"] as const) {
    const families = new Set(
      faces
        .filter((f) => (section === "firm" ? f.source === "firm" : f.source !== "firm"))
        .map((f) => f.family)
        .filter(Boolean),
    );
    for (const family of [...families].sort((a, b) => a.localeCompare(b))) {
      const key = `${section}:${squash(family)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, section, label: family });
    }
  }
  return out;
}

export interface ResolveInput {
  option: FontOption;
  bold: boolean;
  italic: boolean;
  /** The text that will be written with it. */
  text: string;
  /** The paragraph's own PDF font (null for new text). */
  ownFont: string | null;
  faces: IndexedFace[];
  metrics(face: IndexedFace): Promise<FaceMetrics | null>;
  /** The face's font file (embedded by the engine). */
  bytes(face: IndexedFace): Promise<Uint8Array>;
}

/** What picking `option` with these toggles writes, and what to warn about. */
export async function resolveFont(input: ResolveInput): Promise<Resolved> {
  const { option, bold, italic, text, ownFont, faces } = input;
  if (option.section === "document" || option.section === "standard") {
    const pdfName = option.pdfName ?? option.label;
    const want = parsePdfFontName(pdfName);
    // The paragraph's own font with its own weight and slant: keep it as it is.
    if (ownFont) {
      const own = parsePdfFontName(ownFont);
      if (squash(own.family) === squash(want.family) && own.bold === bold && own.italic === italic)
        return {
          font: { kind: "original" },
          writes: `${spaced(own.family)} (this document's font)`,
          fakeBold: false,
          fakeItalic: false,
          warnings: [],
        };
    }
    const std = standardFamily(want.family);
    if (std) {
      const [r, b, i, bi] = STANDARD[std] ?? [];
      const name = (bold ? (italic ? bi : b) : italic ? i : r) ?? "Helvetica";
      const outside = [...new Set([...text].filter((c) => !inWinAnsi(c)))];
      return {
        font: { kind: "standard", name },
        writes: `${name} (standard font, not embedded)`,
        fakeBold: false,
        fakeItalic: false,
        warnings: outside.length
          ? [{ level: "error", text: `${name} has no ${outside.join(" ")}.` }]
          : [],
      };
    }
    // Another font embedded in this PDF: only the letters it already uses are in the
    // file, so the same font is looked up installed (or its twin, or the closest).
    const styleName = `${want.family}${bold || italic ? `-${bold ? "Bold" : ""}${italic ? "Italic" : ""}` : ""}`;
    const match = await matchFont(faces, styleName, {
      metrics: input.metrics,
      needs: text,
    });
    const face = match.exact ?? match.proposals[0]?.face ?? null;
    if (!face)
      return {
        font: null,
        writes: "",
        fakeBold: false,
        fakeItalic: false,
        warnings: [
          {
            level: "error",
            text: `${spaced(want.family)} is only embedded in this PDF (not installed), and no installed font has every letter needed.`,
          },
        ],
      };
    const note: Warning = match.twin
      ? {
          level: "info",
          text: `${face.family} replaces ${spaced(want.family)}: same letter widths, so lines break the same.`,
        }
      : match.exact
        ? { level: "info", text: `Uses the installed ${face.fullName}.` }
        : {
            level: "info",
            text: `${spaced(want.family)} isn't installed: uses the closest font, ${face.fullName}.`,
          };
    const r = await fromFace(face, bold, italic, input);
    return { ...r, warnings: [note, ...r.warnings] };
  }

  const regular =
    findStyle(faces, option.label, bold, italic) ??
    findStyle(faces, option.label, bold, false) ??
    findStyle(faces, option.label, false, false) ??
    faces.find((f) => f.family === option.label && !f.cff) ??
    null;
  if (!regular)
    return {
      font: null,
      writes: "",
      fakeBold: false,
      fakeItalic: false,
      warnings: [
        {
          level: "error",
          text: `${option.label} has only PostScript (CFF) outlines, which can't be embedded yet.`,
        },
      ],
    };
  return fromFace(regular, bold, italic, input);
}

async function fromFace(
  face: IndexedFace,
  bold: boolean,
  italic: boolean,
  input: ResolveInput,
): Promise<Resolved> {
  const warnings: Warning[] = [];
  if (!face.embedding.allowed)
    return {
      font: null,
      writes: face.fullName,
      fakeBold: false,
      fakeItalic: false,
      warnings: [{ level: "error", text: face.embedding.note ?? "This font can't be embedded." }],
    };
  if (face.embedding.note) warnings.push({ level: "info", text: face.embedding.note });
  if (!face.embedding.subsetAllowed)
    warnings.push({
      level: "info",
      text: "This font's license forbids subsetting: the whole font is embedded (larger file).",
    });
  const fakeBold = bold && face.weight < 600;
  const fakeItalic = italic && !face.italic;
  if (fakeBold)
    warnings.push({ level: "info", text: `${face.family} has no bold: bold is simulated.` });
  if (fakeItalic)
    warnings.push({ level: "info", text: `${face.family} has no italic: italic is simulated.` });
  const m = await input.metrics(face);
  const missing = m ? m.missing(input.text) : [];
  if (!m) warnings.push({ level: "error", text: `${face.fullName} could not be read.` });
  else if (missing.length)
    warnings.push({ level: "error", text: `${face.fullName} has no ${missing.join(" ")}.` });
  const bytes = m ? await input.bytes(face).catch(() => null) : null;
  return {
    font: bytes ? { kind: "file", face, bytes } : null,
    writes: `${face.fullName} (${face.source === "firm" ? "firm font" : "installed"}, embedded subset)`,
    fakeBold,
    fakeItalic,
    warnings,
  };
}

/** Windows-1252 (WinAnsi): what the standard 14 fonts can show without embedding. */
const WIN_ANSI_EXTRA = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split("").map((c) => c.codePointAt(0)),
);
export function inWinAnsi(c: string): boolean {
  const cp = c.codePointAt(0) ?? 0;
  return (
    /\s/.test(c) ||
    (cp >= 0x20 && cp <= 0x7e) ||
    (cp >= 0xa0 && cp <= 0xff) ||
    WIN_ANSI_EXTRA.has(cp)
  );
}
