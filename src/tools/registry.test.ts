// Tool registry rules (backlog B4).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUICK_TOOLBAR,
  TOOLS,
  cleanQuickToolbar,
  parseFirmLayout,
  pinnableActions,
  resolveAction,
} from "./registry";

describe("tool registry", () => {
  it("has unique tool ids and unique actions per tool", () => {
    const ids = TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const refs = pinnableActions();
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("the default quick toolbar only uses built tools", () => {
    for (const r of DEFAULT_QUICK_TOOLBAR) {
      const hit = resolveAction(r);
      expect(hit, r).not.toBeNull();
    }
  });

  it('no tool carries a "coming later" placeholder (B8)', () => {
    for (const t of TOOLS) expect("comingIn" in t, t.id).toBe(false);
  });

  it("cleans saved toolbars: drops unknown, unbuilt and duplicate entries", () => {
    expect(
      cleanQuickToolbar(["organize.extract", "nope.x", "organize.extract", "forms.fill", 3]),
    ).toEqual(["organize.extract"]);
    expect(cleanQuickToolbar("organize.extract")).toBeNull();
  });

  it("reads the firm layout file and rejects other formats", () => {
    expect(
      parseFirmLayout(JSON.stringify({ version: 1, quickToolbar: ["view.fitPage", "x.y"] })),
    ).toEqual(["view.fitPage"]);
    expect(() => parseFirmLayout(JSON.stringify({ version: 2, quickToolbar: [] }))).toThrow(
      /version/,
    );
    expect(() => parseFirmLayout("not json")).toThrow();
  });
});
