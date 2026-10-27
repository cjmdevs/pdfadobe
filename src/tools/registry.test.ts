// Tool registry rules (backlog B4).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUICK_TOOLBAR,
  TOOLS,
  cleanQuickToolbar,
  comingLabel,
  isBuilt,
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
      expect(hit !== null && isBuilt(hit.tool), r).toBe(true);
    }
  });

  it("unbuilt tools say when they come and cannot run", () => {
    const planned = TOOLS.filter((t) => !isBuilt(t));
    expect(planned.length).toBeGreaterThan(0);
    for (const t of planned) {
      expect(comingLabel(t)).toMatch(/^Coming in/);
      expect(comingLabel({ ...t, comingIn: 7 })).toBe("Coming in Phase 7");
    }
  });

  it("cleans saved toolbars: drops unknown, unbuilt and duplicate entries", () => {
    expect(
      cleanQuickToolbar(["organize.extract", "nope.x", "organize.extract", "redact.mark", 3]),
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
