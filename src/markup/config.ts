// EmbedPDF annotation plugin setup (Phase 3). No React here.

import type { AnnotationPluginConfig, AnnotationToolOverride } from "@embedpdf/plugin-annotation";
import { PdfAnnotationLineEnding } from "@embedpdf/models";
import type { Settings } from "../app/settings";
import { patchFromStyle } from "./properties";

/** Used until the Windows display name arrives (and in the browser build). */
export const FALLBACK_AUTHOR = "Reviewer";

/** Our Cloud tool (EmbedPDF's polygon tool with a cloudy border; see MarkupBridge). */
export const CLOUD_TOOL = "cloud";
/** Interaction mode of the ink eraser (EraserLayer). */
export const ERASER_MODE = "markupEraser";
/** Interaction mode while a picked stamp waits for its click (StampLayer). */
export const STAMP_MODE = "markupStamp";
/** Interaction mode while "Digitally Sign" waits for the signature's box (SignBoxLayer). */
export const SIGN_BOX_MODE = "signBox";
/** Fill & Sign's text tool: EmbedPDF's text box without a border (see MarkupBridge). */
export const FILL_TEXT_TOOL = "fillText";

/** Markup buttons in the Comment toolbar: EmbedPDF tool id, label, icon. */
export const MARKUP_TOOLS = [
  { id: "textComment", label: "Sticky note", icon: "note" },
  { id: "highlight", label: "Highlight", icon: "highlight" },
  { id: "underline", label: "Underline", icon: "underline" },
  { id: "strikeout", label: "Strikethrough", icon: "strikeout" },
  { id: "squiggly", label: "Squiggly", icon: "squiggly" },
  { id: "freeText", label: "Text box", icon: "textbox" },
  { id: "freeTextCallout", label: "Callout", icon: "callout" },
  { id: "square", label: "Rectangle", icon: "shape" },
  { id: "circle", label: "Ellipse", icon: "ellipse" },
  { id: "line", label: "Line", icon: "line" },
  { id: "lineArrow", label: "Arrow", icon: "arrow" },
  { id: "polyline", label: "Polyline", icon: "polyline" },
  { id: "polygon", label: "Polygon", icon: "polygon" },
  { id: CLOUD_TOOL, label: "Cloud", icon: "cloud" },
  { id: "ink", label: "Draw", icon: "ink" },
] as const;

/** Our name for an EmbedPDF tool ("square" -> "Rectangle"). */
export function markupToolLabel(id: string | null | undefined): string | null {
  return MARKUP_TOOLS.find((t) => t.id === id)?.label ?? null;
}

/**
 * Firm defaults (closer to Acrobat than EmbedPDF's): thin red shapes, yellow highlight,
 * black 12 pt text in a red-bordered box. The user's "Make default" choices go on top.
 */
const FIRM_DEFAULTS: Record<string, Record<string, unknown>> = {
  highlight: { strokeColor: "#FFFF00", color: "#FFFF00" },
  underline: { strokeColor: "#00B050" },
  strikeout: { strokeColor: "#FF0000", intent: undefined },
  squiggly: { strokeColor: "#0070C0" },
  textComment: { strokeColor: "#FFFF00" },
  freeText: {
    contents: "",
    fontSize: 12,
    fontColor: "#000000",
    strokeColor: "#FF0000",
    strokeWidth: 1,
  },
  freeTextCallout: {
    contents: "",
    fontSize: 12,
    fontColor: "#000000",
    strokeColor: "#FF0000",
    strokeWidth: 1,
  },
  square: { strokeWidth: 2, strokeColor: "#FF0000" },
  circle: { strokeWidth: 2, strokeColor: "#FF0000" },
  line: { strokeWidth: 2, strokeColor: "#FF0000" },
  lineArrow: {
    strokeWidth: 2,
    strokeColor: "#FF0000",
    lineEndings: { start: PdfAnnotationLineEnding.None, end: PdfAnnotationLineEnding.OpenArrow },
  },
  polyline: { strokeWidth: 2, strokeColor: "#FF0000" },
  polygon: { strokeWidth: 2, strokeColor: "#FF0000" },
  [CLOUD_TOOL]: { strokeWidth: 1, strokeColor: "#FF0000" },
  ink: { strokeWidth: 2, strokeColor: "#0000FF", color: "#0000FF" },
};

export function toolDefaults(settings: Settings, toolId: string): Record<string, unknown> {
  const mine = settings.markupDefaults[toolId];
  return { ...FIRM_DEFAULTS[toolId], ...(mine ? patchFromStyle(mine) : {}) };
}

export function markupConfig(settings: Settings): Partial<AnnotationPluginConfig> {
  // The Cloud tool is added at runtime (MarkupBridge), so it takes no override here.
  const tools: AnnotationToolOverride[] = Object.keys(FIRM_DEFAULTS)
    .filter((id) => id !== CLOUD_TOOL)
    .map((id): AnnotationToolOverride => ({
      id,
      defaults: toolDefaults(settings, id),
    }))
    // Links get a category of their own, so they can be locked apart from markup.
    .concat([{ id: "link", categories: ["link"] }]);
  return {
    autoCommit: true,
    annotationAuthor: settings.authorName ?? FALLBACK_AUTHOR,
    colorPresets: settings.markupColors,
    selectAfterCreate: true,
    deactivateToolAfterCreate: false,
    // Links are not opened by clicking inside the annotation layer (no network calls).
    autoOpenLinks: false,
    tools,
  };
}
