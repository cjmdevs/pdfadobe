// One annotation of every Phase 3 markup type, in EmbedPDF page space (top-left
// origin). Shared by the engine round-trip test and the browser tests.

import {
  PdfAnnotationBorderStyle,
  PdfAnnotationLineEnding,
  PdfAnnotationName,
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfAnnotationObject,
  type Rect,
} from "@embedpdf/models";

export const AUTHOR = "Test Reviewer";
const created = new Date("2026-10-23T09:00:00Z");

const r = (x: number, y: number, w: number, h: number): Rect => ({
  origin: { x, y },
  size: { width: w, height: h },
});

export interface Sample {
  /** Expected PDF /Subtype. */
  subtype: string;
  /** Hex color expected in /C ("stroke") or /IC ("interior"). */
  color: { key: "C" | "IC"; hex: string } | null;
  anno: PdfAnnotationObject;
}

const base = (id: string, rect: Rect, contents: string) => ({
  id,
  pageIndex: 0,
  rect,
  contents,
  author: AUTHOR,
  created,
  modified: created,
  flags: ["print" as const],
});

export const SAMPLES: Sample[] = [
  ...(
    [
      [PdfAnnotationSubtype.HIGHLIGHT, "Highlight", "#FFFF00"],
      [PdfAnnotationSubtype.UNDERLINE, "Underline", "#00B050"],
      [PdfAnnotationSubtype.STRIKEOUT, "StrikeOut", "#FF0000"],
      [PdfAnnotationSubtype.SQUIGGLY, "Squiggly", "#0070C0"],
    ] as const
  ).map(([type, subtype, hex], i): Sample => {
    const rect = r(72, 80 + i * 20, 200, 14);
    return {
      subtype,
      color: { key: "C", hex },
      anno: {
        ...base(`markup-${i}`, rect, `${subtype} note`),
        type,
        strokeColor: hex,
        opacity: 1,
        segmentRects: [rect],
      } as PdfAnnotationObject,
    };
  }),
  {
    subtype: "Text",
    color: { key: "C", hex: "#FFC000" },
    anno: {
      ...base("note", r(300, 80, 20, 20), "Sticky note: tie to TB"),
      type: PdfAnnotationSubtype.TEXT,
      strokeColor: "#FFC000",
      opacity: 1,
      name: PdfAnnotationName.Comment,
    },
  },
  {
    subtype: "FreeText",
    color: { key: "C", hex: "#FFF2CC" },
    anno: {
      ...base("freetext", r(72, 180, 200, 40), "Free text box"),
      type: PdfAnnotationSubtype.FREETEXT,
      fontFamily: PdfStandardFont.Helvetica,
      fontSize: 12,
      fontColor: "#C00000",
      textAlign: PdfTextAlignment.Left,
      verticalAlign: PdfVerticalAlignment.Top,
      opacity: 1,
      color: "#FFF2CC",
      strokeColor: "#C00000",
      strokeWidth: 1,
    },
  },
  {
    subtype: "FreeText",
    color: null,
    anno: {
      ...base("callout", r(300, 180, 220, 90), "Callout: see A-1"),
      type: PdfAnnotationSubtype.FREETEXT,
      intent: "FreeTextCallout",
      fontFamily: PdfStandardFont.Times_Roman,
      fontSize: 11,
      fontColor: "#000000",
      textAlign: PdfTextAlignment.Left,
      verticalAlign: PdfVerticalAlignment.Top,
      opacity: 1,
      strokeColor: "#0000FF",
      strokeWidth: 1,
      calloutLine: [
        { x: 305, y: 265 },
        { x: 360, y: 240 },
        { x: 400, y: 240 },
      ],
      lineEnding: PdfAnnotationLineEnding.OpenArrow,
      rectangleDifferences: { left: 100, top: 0, right: 0, bottom: 30 },
    },
  },
  {
    subtype: "Square",
    color: { key: "C", hex: "#FF0000" },
    anno: {
      ...base("square", r(72, 300, 120, 60), "Rectangle"),
      type: PdfAnnotationSubtype.SQUARE,
      color: "transparent",
      opacity: 1,
      strokeWidth: 2,
      strokeColor: "#FF0000",
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
    },
  },
  {
    subtype: "Circle",
    color: { key: "IC", hex: "#DDEBF7" },
    anno: {
      ...base("ellipse", r(220, 300, 120, 60), "Ellipse"),
      type: PdfAnnotationSubtype.CIRCLE,
      color: "#DDEBF7",
      opacity: 1,
      strokeWidth: 2,
      strokeColor: "#0070C0",
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
    },
  },
  {
    subtype: "Line",
    color: { key: "C", hex: "#000000" },
    anno: {
      ...base("line", r(72, 390, 200, 10), "Line"),
      type: PdfAnnotationSubtype.LINE,
      linePoints: { start: { x: 75, y: 395 }, end: { x: 270, y: 395 } },
      lineEndings: { start: PdfAnnotationLineEnding.None, end: PdfAnnotationLineEnding.None },
      color: "transparent",
      opacity: 1,
      strokeWidth: 1,
      strokeColor: "#000000",
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
    },
  },
  {
    subtype: "Line",
    color: { key: "C", hex: "#C00000" },
    anno: {
      ...base("arrow", r(300, 380, 200, 30), "Arrow"),
      type: PdfAnnotationSubtype.LINE,
      intent: "LineArrow",
      linePoints: { start: { x: 305, y: 405 }, end: { x: 495, y: 385 } },
      lineEndings: { start: PdfAnnotationLineEnding.None, end: PdfAnnotationLineEnding.OpenArrow },
      color: "transparent",
      opacity: 1,
      strokeWidth: 2,
      strokeColor: "#C00000",
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
    },
  },
  {
    subtype: "PolyLine",
    color: { key: "C", hex: "#7030A0" },
    anno: {
      ...base("polyline", r(72, 430, 200, 60), "Polyline"),
      type: PdfAnnotationSubtype.POLYLINE,
      vertices: [
        { x: 75, y: 485 },
        { x: 130, y: 435 },
        { x: 190, y: 480 },
        { x: 265, y: 440 },
      ],
      color: "transparent",
      opacity: 1,
      strokeWidth: 2,
      strokeColor: "#7030A0",
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
    },
  },
  {
    subtype: "Polygon",
    color: { key: "C", hex: "#00B050" },
    anno: {
      ...base("polygon", r(300, 430, 160, 70), "Polygon"),
      type: PdfAnnotationSubtype.POLYGON,
      vertices: [
        { x: 305, y: 495 },
        { x: 380, y: 435 },
        { x: 455, y: 495 },
      ],
      color: "transparent",
      opacity: 1,
      strokeWidth: 2,
      strokeColor: "#00B050",
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
    },
  },
  {
    subtype: "Polygon",
    color: { key: "C", hex: "#FF0000" },
    anno: {
      ...base("cloud", r(72, 520, 200, 80), "Cloud"),
      type: PdfAnnotationSubtype.POLYGON,
      intent: "PolygonCloud",
      vertices: [
        { x: 85, y: 530 },
        { x: 260, y: 530 },
        { x: 260, y: 590 },
        { x: 85, y: 590 },
      ],
      color: "transparent",
      opacity: 1,
      strokeWidth: 1,
      strokeColor: "#FF0000",
      strokeStyle: PdfAnnotationBorderStyle.CLOUDY,
      cloudyBorderIntensity: 1,
    },
  },
  {
    subtype: "Ink",
    color: { key: "C", hex: "#0000FF" },
    anno: {
      ...base("ink", r(300, 520, 160, 80), "Ink"),
      type: PdfAnnotationSubtype.INK,
      inkList: [
        {
          points: [
            { x: 305, y: 590 },
            { x: 340, y: 530 },
            { x: 380, y: 585 },
            { x: 420, y: 535 },
            { x: 455, y: 590 },
          ],
        },
      ],
      strokeColor: "#0000FF",
      opacity: 1,
      strokeWidth: 3,
    },
  },
];
