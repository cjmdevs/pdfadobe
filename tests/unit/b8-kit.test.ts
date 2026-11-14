// B8 kit logic: snap guides, units, tooltip text, menu tidying.
import { describe, expect, it } from "vitest";
import { snapMove, snapPoint, snapResize } from "../../src/ui/kit/snap";
import { formatLength, fromPoints } from "../../src/app/units";
import { splitTip, tidy, type MenuEntry } from "../../src/ui/kit/menuText";

const page = { w: 612, h: 792 };

describe("snap guides", () => {
  it("snaps a moved box's left edge to the page edge within the threshold", () => {
    const r = snapMove({ x: 4, y: 300, w: 100, h: 50 }, [], page, 6);
    expect(r.box.x).toBe(0);
    expect(r.box.y).toBe(300);
    expect(r.guides).toEqual([{ axis: "x", at: 0, from: 0, to: 792 }]);
  });

  it("leaves a box alone when nothing is near", () => {
    const r = snapMove({ x: 50, y: 300, w: 100, h: 50 }, [], page, 6);
    expect(r.box).toEqual({ x: 50, y: 300, w: 100, h: 50 });
    expect(r.guides).toHaveLength(0);
  });

  it("snaps centres to the page centre and edges to other objects, closest first", () => {
    const other = { x: 200, y: 100, w: 80, h: 40 };
    const r = snapMove({ x: 254, y: 143, w: 100, h: 30 }, [other], page, 6);
    // Centre 304 -> page centre 306 (2 away) beats left 254 -> nothing; top 143 -> 140 (other's bottom).
    expect(r.box.x).toBe(256);
    expect(r.box.y).toBe(140);
    expect(r.guides.map((g) => g.axis).sort()).toEqual(["x", "y"]);
  });

  it("resizing moves only the dragged edges", () => {
    const r = snapResize({ x: 100, y: 100, w: 508, h: 50 }, "e", [], page, 6);
    expect(r.box).toEqual({ x: 100, y: 100, w: 512, h: 50 });
    const nw = snapResize({ x: 3, y: 2, w: 50, h: 50 }, "nw", [], page, 6);
    expect(nw.box).toEqual({ x: 0, y: 0, w: 53, h: 52 });
  });

  it("never resizes below the minimum size", () => {
    const r = snapResize(
      { x: 100, y: 100, w: 3, h: 3 },
      "w",
      [{ x: 104, y: 0, w: 1, h: 1 }],
      page,
      6,
      2,
    );
    expect(r.box.w).toBeGreaterThanOrEqual(2);
  });

  it("snaps a drawn corner to edges", () => {
    expect(snapPoint({ x: 609, y: 420 }, [], page, 6)).toMatchObject({ x: 612, y: 420 });
  });
});

describe("units", () => {
  it("converts points", () => {
    expect(fromPoints(72, "in")).toBe(1);
    expect(formatLength(72, "in")).toBe("1.00 in");
    expect(formatLength(72, "mm")).toBe("25.4 mm");
    expect(formatLength(12.4, "pt")).toBe("12 pt");
    expect(formatLength(-0.001, "in")).toBe("0.00 in");
  });
});

describe("tooltips", () => {
  it("splits a trailing shortcut off the label", () => {
    expect(splitTip("Open (Ctrl+O)")).toEqual({ label: "Open", keys: "Ctrl+O" });
    expect(splitTip("Close pane (F4)")).toEqual({ label: "Close pane", keys: "F4" });
    expect(splitTip("Last page (End)")).toEqual({ label: "Last page", keys: "End" });
    expect(splitTip("Previous page (Left arrow)")).toEqual({
      label: "Previous page",
      keys: "Left arrow",
    });
  });
  it("keeps brackets that are not keys", () => {
    expect(splitTip("Rotate (90°)")).toEqual({ label: "Rotate (90°)", keys: null });
    expect(splitTip("Settings…")).toEqual({ label: "Settings…", keys: null });
  });
});

describe("menus", () => {
  it("drops leading, trailing and doubled dividers", () => {
    const run = () => undefined;
    const items: MenuEntry[] = [
      { kind: "divider" },
      { id: "a", label: "A", run },
      { kind: "divider" },
      { kind: "divider" },
      { id: "b", label: "B", run },
      { kind: "divider" },
    ];
    expect(tidy(items).map((i) => (i.kind === "divider" ? "-" : i.id))).toEqual(["a", "-", "b"]);
  });
});
