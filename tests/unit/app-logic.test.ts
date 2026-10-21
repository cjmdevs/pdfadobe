import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  MAX_RECENT,
  addRecent,
  removeRecent,
  samePath,
  sanitizeSettings,
} from "../../src/app/settings";
import { SHORTCUTS, displayKey, matchShortcut, type KeyLike } from "../../src/app/shortcuts";
import {
  ACTUAL_SIZE_SCALE,
  parsePercent,
  percentToScale,
  scaleToPercent,
} from "../../src/app/zoom";
import { suffixedPath, baseName } from "../../src/platform/types";

function key(k: string, code: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key: k, code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods };
}

describe("settings", () => {
  it("falls back to defaults for junk", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ theme: "purple", zoom: -3, viewMode: 7 })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values", () => {
    const s = sanitizeSettings({
      theme: "dark",
      zoom: 1.5,
      viewMode: "twoUp",
      openTabs: ["C:\\a.pdf", "c:/A.PDF", "D:\\b.pdf"],
      activeTab: "D:\\b.pdf",
    });
    expect(s.theme).toBe("dark");
    expect(s.zoom).toBe(1.5);
    expect(s.viewMode).toBe("twoUp");
    expect(s.openTabs).toEqual(["C:\\a.pdf", "D:\\b.pdf"]);
    expect(s.activeTab).toBe("D:\\b.pdf");
  });

  it("drops an active tab that is not open", () => {
    expect(
      sanitizeSettings({ openTabs: ["C:\\a.pdf"], activeTab: "C:\\z.pdf" }).activeTab,
    ).toBeNull();
  });

  it("maintains a case-insensitive, capped recent list", () => {
    let r: string[] = [];
    for (let i = 0; i < 20; i++) r = addRecent(r, `C:\\f${i}.pdf`);
    expect(r).toHaveLength(MAX_RECENT);
    expect(r[0]).toBe("C:\\f19.pdf");
    r = addRecent(r, "c:\\F5.PDF");
    expect(r[0]).toBe("c:\\F5.PDF");
    expect(r.filter((p) => samePath(p, "C:\\f5.pdf"))).toHaveLength(1);
    expect(removeRecent(r, "C:\\F19.pdf")).not.toContain("C:\\f19.pdf");
    expect(samePath("\\\\server\\share\\a.pdf", "//SERVER/share/A.pdf")).toBe(true);
  });
});

describe("shortcuts", () => {
  it("matches Acrobat's published keys", () => {
    expect(matchShortcut(key("N", "KeyN", { ctrlKey: true, shiftKey: true }), false)).toBe(
      "goToPage",
    );
    expect(matchShortcut(key("=", "Equal", { ctrlKey: true }), false)).toBe("zoomIn");
    expect(matchShortcut(key("+", "NumpadAdd", { ctrlKey: true }), false)).toBe("zoomIn");
    // Ctrl+Shift+Plus: on a US layout Shift turns "=" into "+", so match by code.
    expect(matchShortcut(key("+", "Equal", { ctrlKey: true, shiftKey: true }), false)).toBe(
      "rotateCw",
    );
    expect(matchShortcut(key("_", "Minus", { ctrlKey: true, shiftKey: true }), false)).toBe(
      "rotateCcw",
    );
    expect(matchShortcut(key("0", "Digit0", { ctrlKey: true }), false)).toBe("fitPage");
    expect(matchShortcut(key("F3", "F3"), false)).toBe("findNext");
    expect(matchShortcut(key("F3", "F3", { shiftKey: true }), false)).toBe("findPrev");
    expect(matchShortcut(key("Home", "Home"), false)).toBe("firstPage");
    expect(matchShortcut(key("ArrowUp", "ArrowUp", { ctrlKey: true, shiftKey: true }), false)).toBe(
      "firstPage",
    );
    expect(matchShortcut(key("Tab", "Tab", { ctrlKey: true }), false)).toBe("nextTab");
    expect(matchShortcut(key("F4", "F4", { ctrlKey: true }), false)).toBe("close");
  });

  it("does not steal keys while typing", () => {
    expect(matchShortcut(key("ArrowRight", "ArrowRight"), true)).toBeNull();
    expect(matchShortcut(key("Home", "Home"), true)).toBeNull();
    expect(matchShortcut(key("a", "KeyA", { ctrlKey: true }), true)).toBeNull();
    expect(matchShortcut(key("Enter", "Enter"), true)).toBeNull();
    expect(matchShortcut(key("F3", "F3"), true)).toBe("findNext");
    expect(matchShortcut(key("Escape", "Escape"), true)).toBe("escape");
    expect(matchShortcut(key("p", "KeyP", { ctrlKey: true }), true)).toBe("print");
  });

  it("has no key bound to two commands", () => {
    const seen = new Map<string, string>();
    for (const s of SHORTCUTS)
      for (const k of s.keys) {
        expect(seen.get(k), `${k} is bound twice`).toBeUndefined();
        seen.set(k, s.command);
      }
  });

  it("formats keys for display", () => {
    expect(displayKey("Ctrl+Shift+Equal")).toBe("Ctrl+Shift+=");
    expect(displayKey("Ctrl+Digit2")).toBe("Ctrl+2");
  });
});

describe("zoom", () => {
  it("shows Actual Size as 100%", () => {
    expect(scaleToPercent(ACTUAL_SIZE_SCALE)).toBe(100);
    expect(percentToScale(150)).toBeCloseTo(2);
    expect(parsePercent(" 87.5 % ")).toBe(87.5);
    expect(parsePercent("abc")).toBeNull();
    expect(parsePercent("1")).toBeNull();
  });
});

describe("paths", () => {
  it("names repaired copies next to the original", () => {
    expect(suffixedPath("C:\\Clients\\a.pdf", "repaired")).toBe("C:\\Clients\\a (repaired).pdf");
    expect(suffixedPath("\\\\srv\\s\\B.PDF", "repaired")).toBe("\\\\srv\\s\\B (repaired).pdf");
    expect(baseName("\\\\srv\\share\\dir\\x.pdf")).toBe("x.pdf");
    expect(baseName("/tmp/y.pdf")).toBe("y.pdf");
  });
});
