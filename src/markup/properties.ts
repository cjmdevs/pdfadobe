// Which style properties the properties bar offers for an annotation or markup tool,
// and how "Make default" picks them out. No React here (unit-tested in Node).

import {
  PdfAnnotationBorderStyle,
  PdfAnnotationLineEnding,
  PdfAnnotationSubtype,
  PdfStandardFont,
  type PdfAnnotationObject,
} from "@embedpdf/models";

export type MarkupProp =
  | "strokeColor"
  | "color"
  | "fontColor"
  | "opacity"
  | "strokeWidth"
  | "strokeStyle"
  | "cloudyBorderIntensity"
  | "lineEndings"
  | "lineEnding"
  | "fontFamily"
  | "fontSize";

/** Properties shown for an annotation (or a tool's default annotation). */
export function propsFor(a: Pick<PdfAnnotationObject, "type" | "intent">): MarkupProp[] {
  switch (a.type) {
    case PdfAnnotationSubtype.HIGHLIGHT:
    case PdfAnnotationSubtype.UNDERLINE:
    case PdfAnnotationSubtype.STRIKEOUT:
    case PdfAnnotationSubtype.SQUIGGLY:
    case PdfAnnotationSubtype.TEXT:
      return ["strokeColor", "opacity"];
    case PdfAnnotationSubtype.FREETEXT:
      return a.intent === "FreeTextCallout"
        ? [
            "fontColor",
            "fontFamily",
            "fontSize",
            "color",
            "strokeColor",
            "strokeWidth",
            "lineEnding",
            "opacity",
          ]
        : ["fontColor", "fontFamily", "fontSize", "color", "strokeColor", "strokeWidth", "opacity"];
    case PdfAnnotationSubtype.SQUARE:
    case PdfAnnotationSubtype.CIRCLE:
    case PdfAnnotationSubtype.POLYGON:
      return ["strokeColor", "color", "strokeWidth", "strokeStyle", "opacity"];
    case PdfAnnotationSubtype.LINE:
    case PdfAnnotationSubtype.POLYLINE:
      return ["strokeColor", "strokeWidth", "strokeStyle", "lineEndings", "opacity"];
    case PdfAnnotationSubtype.INK:
      return ["strokeColor", "strokeWidth", "opacity"];
    default:
      return [];
  }
}

/** The style part of an annotation, for "Make default" (never text, rect or ids). */
export function styleOf(a: PdfAnnotationObject): Record<string, string | number | boolean> {
  const src = a as unknown as Record<string, unknown>;
  const out: Record<string, string | number | boolean> = {};
  for (const p of propsFor(a)) {
    const v = src[p];
    if (p === "lineEndings" && v && typeof v === "object") {
      const le = v as { start: number; end: number };
      out.lineEndingStart = le.start;
      out.lineEndingEnd = le.end;
    } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[p] = v;
    }
  }
  if (src.cloudyBorderIntensity !== undefined && typeof src.cloudyBorderIntensity === "number")
    out.cloudyBorderIntensity = src.cloudyBorderIntensity;
  return out;
}

/** Settings form (flat) -> annotation patch (lineEndings is an object there). */
export function patchFromStyle(
  style: Record<string, string | number | boolean>,
): Partial<PdfAnnotationObject> {
  const { lineEndingStart, lineEndingEnd, ...rest } = style;
  const patch: Record<string, unknown> = { ...rest };
  if (typeof lineEndingStart === "number" && typeof lineEndingEnd === "number")
    patch.lineEndings = { start: lineEndingStart, end: lineEndingEnd };
  return patch as Partial<PdfAnnotationObject>;
}

/** Border styles offered for shapes; "cloudy" sets the cloud effect (/BE). */
export const BORDER_STYLES = [
  { value: PdfAnnotationBorderStyle.SOLID, label: "Solid" },
  { value: PdfAnnotationBorderStyle.DASHED, label: "Dashed" },
  { value: PdfAnnotationBorderStyle.CLOUDY, label: "Cloudy" },
] as const;

export const LINE_ENDINGS = [
  { value: PdfAnnotationLineEnding.None, label: "None" },
  { value: PdfAnnotationLineEnding.OpenArrow, label: "Open arrow" },
  { value: PdfAnnotationLineEnding.ClosedArrow, label: "Closed arrow" },
  { value: PdfAnnotationLineEnding.Circle, label: "Circle" },
  { value: PdfAnnotationLineEnding.Square, label: "Square" },
  { value: PdfAnnotationLineEnding.Diamond, label: "Diamond" },
  { value: PdfAnnotationLineEnding.Butt, label: "Butt" },
] as const;

/** Standard PDF fonts (no embedding), which PDFium can write into a free-text appearance. */
export const FONTS = [
  { value: PdfStandardFont.Helvetica, label: "Helvetica" },
  { value: PdfStandardFont.Helvetica_Bold, label: "Helvetica Bold" },
  { value: PdfStandardFont.Helvetica_Oblique, label: "Helvetica Italic" },
  { value: PdfStandardFont.Times_Roman, label: "Times" },
  { value: PdfStandardFont.Times_Bold, label: "Times Bold" },
  { value: PdfStandardFont.Times_Italic, label: "Times Italic" },
  { value: PdfStandardFont.Courier, label: "Courier" },
  { value: PdfStandardFont.Courier_Bold, label: "Courier Bold" },
] as const;

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36] as const;
export const STROKE_WIDTHS = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12] as const;
export const OPACITIES = [1, 0.75, 0.5, 0.25] as const;

/** Cloud intensity used when "Cloudy" is chosen (Acrobat's default look). */
export const CLOUD_INTENSITY = 1;
