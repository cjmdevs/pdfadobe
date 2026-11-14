// Logic behind the fixes from the B8 code review.
import { describe, expect, it } from "vitest";
import { leftRunning, type Running } from "../../src/app/toolSwitch";
import { isJump, pageStep } from "../../src/app/viewHistory";
import { BAR_SPACER, withDivider } from "../../src/app/topBar";
import { QUICK_DIVIDER } from "../../src/tools/registry";

describe("leaving a tool", () => {
  const idle: Running = { tool: null, markup: null, mode: "default", stamp: null, flyer: null };

  it("stops nothing while the open tool stays the same", () => {
    const on = { ...idle, tool: "comment", markup: "square" };
    expect(leftRunning(on, on)).toEqual({ markup: false, mode: false });
  });

  it("stops what was already running when the tool changes", () => {
    const was = { ...idle, tool: "comment", markup: "square", mode: "stamp", stamp: {} };
    expect(leftRunning(was, { ...was, tool: null })).toEqual({ markup: true, mode: true });
  });

  it("keeps what the same click started", () => {
    // Redact > Draw box from the top bar: opens Redact and turns the box mode on at once.
    const now = { ...idle, tool: "redact", mode: "redact" };
    expect(leftRunning(idle, now)).toEqual({ markup: false, mode: false });
    // A different markup tool or a newly picked stamp is new too.
    const stampA = {};
    const was = { ...idle, tool: "comment", markup: "square", mode: "stamp", stamp: stampA };
    expect(leftRunning(was, { ...was, tool: "stamp", markup: "circle", stamp: {} })).toEqual({
      markup: false,
      mode: false,
    });
  });
});

describe("view history jumps", () => {
  it("paging is not a jump, in two-up either (a spread is one step)", () => {
    expect(isJump(4, 5, pageStep("continuous"), false)).toBe(false);
    expect(isJump(4, 6, pageStep("twoUp"), false)).toBe(false);
    expect(isJump(4, 6, pageStep("continuous"), false)).toBe(true);
    expect(isJump(4, 8, pageStep("twoUp"), false)).toBe(true);
  });

  it("an asked-for move is a jump even by one page, but not to the same page", () => {
    expect(isJump(4, 5, 1, true)).toBe(true);
    expect(isJump(4, 4, 1, true)).toBe(false);
  });
});

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
