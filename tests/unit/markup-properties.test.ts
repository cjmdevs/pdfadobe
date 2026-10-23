import { describe, expect, it } from "vitest";
import {
  PdfAnnotationLineEnding,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
} from "@embedpdf/models";
import { patchFromStyle, propsFor, styleOf } from "../../src/markup/properties";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../../src/app/settings";
import { markupConfig, toolDefaults } from "../../src/markup/config";
import { SAMPLES } from "../helpers/markup-samples";

describe("markup properties", () => {
  it("every Phase 3 sample type has style properties", () => {
    for (const s of SAMPLES) expect(propsFor(s.anno).length, s.anno.id).toBeGreaterThan(0);
  });

  it("callouts offer an arrow; plain text boxes do not", () => {
    expect(propsFor({ type: PdfAnnotationSubtype.FREETEXT, intent: "FreeTextCallout" })).toContain(
      "lineEnding",
    );
    expect(propsFor({ type: PdfAnnotationSubtype.FREETEXT })).not.toContain("lineEnding");
  });

  it("Make default keeps style only (no text, rect or ids) and round-trips line endings", () => {
    const arrow = SAMPLES.find((s) => s.anno.id === "arrow")!.anno;
    const style = styleOf(arrow);
    expect(style).not.toHaveProperty("contents");
    expect(style).not.toHaveProperty("rect");
    expect(style).toMatchObject({ strokeColor: "#C00000", strokeWidth: 2 });
    const patch = patchFromStyle(style) as Partial<PdfAnnotationObject> & {
      lineEndings?: unknown;
    };
    expect(patch.lineEndings).toEqual({
      start: PdfAnnotationLineEnding.None,
      end: PdfAnnotationLineEnding.OpenArrow,
    });
  });

  it("saved defaults survive settings sanitizing; junk is dropped", () => {
    const s = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      markupDefaults: { square: { strokeWidth: 4, evil: { x: 1 } }, "../x": { a: 1 } },
      markupColors: ["#123456", "red", 7],
      authorName: "  J. Reviewer  ",
    });
    expect(s.markupDefaults).toEqual({ square: { strokeWidth: 4 } });
    expect(s.markupColors).toEqual(["#123456"]);
    expect(s.authorName).toBe("J. Reviewer");
  });

  it("user defaults go on top of the firm defaults in the plugin config", () => {
    const s = { ...DEFAULT_SETTINGS, markupDefaults: { square: { strokeWidth: 4 } } };
    expect(toolDefaults(s, "square")).toMatchObject({ strokeWidth: 4, strokeColor: "#FF0000" });
    const cfg = markupConfig(s);
    expect(cfg.autoOpenLinks).toBe(false);
    expect(cfg.tools?.find((t) => t.id === "square")?.defaults).toMatchObject({ strokeWidth: 4 });
  });
});
