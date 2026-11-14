// Top bar layout logic (B8). Lives beside the code because the tool registry it reads
// needs the DOM types (tests/unit is checked without them).
import { describe, expect, it } from "vitest";
import { QUICK_DIVIDER } from "../tools/registry";
import { BAR_SPACER, withDivider } from "./topBar";

describe("top bar dividers", () => {
  const l = {
    bar: ["bar:open", "bar:save", QUICK_DIVIDER, "bar:print", BAR_SPACER, "bar:help"],
    menus: {},
  };

  it("adds a divider after the picked item", () => {
    expect(withDivider(l, 0)?.bar.slice(0, 3)).toEqual(["bar:open", QUICK_DIVIDER, "bar:save"]);
  });

  it("is not offered where the divider would not stay", () => {
    expect(withDivider(l, -1)).toBeNull(); // nothing picked
    expect(withDivider(l, 1)).toBeNull(); // before a divider
    expect(withDivider(l, 2)).toBeNull(); // a divider is picked
    expect(withDivider(l, 3)).toBeNull(); // before the space
    expect(withDivider(l, 4)).toBeNull(); // after the space
    expect(withDivider(l, 5)).toBeNull(); // at the end
  });
});
