// B3 Edit PDF: image handle geometry (move, corner resize keeping proportions,
// rotate with Shift snapping), on plain and rotated images.
import { describe, expect, it } from "vitest";
import { dragPlacement, handlePoints, hitHandle, naturalSize } from "../../src/ui/edit/imageDrag";

const img = { cx: 200, cy: 300, width: 100, height: 50, rotation: 0 };
const near = (a: object, b: Record<string, number>) => {
  const got = a as Record<string, number>;
  for (const k of Object.keys(b)) expect(got[k]).toBeCloseTo(b[k]!, 4);
};

describe("image handles", () => {
  it("finds corners, the rotate handle and the image body", () => {
    const hs = handlePoints(img, 20);
    near(hs.nw, { x: 150, y: 325 });
    near(hs.se, { x: 250, y: 275 });
    near(hs.rotate, { x: 200, y: 345 });
    expect(hitHandle(img, { x: 151, y: 324 }, 4, 20)).toBe("nw");
    expect(hitHandle(img, { x: 200, y: 344 }, 4, 20)).toBe("rotate");
    expect(hitHandle(img, { x: 210, y: 300 }, 4, 20)).toBe("move");
    expect(hitHandle(img, { x: 400, y: 300 }, 4, 20)).toBeNull();
  });

  it("moves by the drag", () => {
    near(dragPlacement(img, "move", { x: 0, y: 0 }, { x: 15, y: -5 }, false), {
      cx: 215,
      cy: 295,
      width: 100,
      height: 50,
    });
  });

  it("resizes from a corner, keeping proportions and the opposite corner", () => {
    // Drag the south-east corner 50 right: 1.5 times as wide, so 1.5 times as tall.
    const r = dragPlacement(img, "se", { x: 250, y: 275 }, { x: 300, y: 275 }, false);
    near(r, { width: 150, height: 75 });
    // The north-west corner stayed at (150, 325).
    near(handlePoints(r, 0).nw, { x: 150, y: 325 });
    // Shift: free resize.
    near(dragPlacement(img, "se", { x: 250, y: 275 }, { x: 300, y: 275 }, true), {
      width: 150,
      height: 50,
    });
  });

  it("resizes a rotated image in its own axes", () => {
    const rot = { ...img, rotation: 90 };
    const start = handlePoints(rot, 0).se;
    const fixed = handlePoints(rot, 0).nw;
    // Pull the corner further out along the image's own x axis (page y, at 90°).
    const r = dragPlacement(rot, "se", start, { x: start.x, y: start.y + 100 }, true);
    near(r, { width: 200, height: 50, rotation: 90 });
    near(handlePoints(r, 0).nw, { x: fixed.x, y: fixed.y });
  });

  it("rotates around the centre; Shift snaps to 15°", () => {
    const from = { x: 200, y: 345 }; // straight above
    const to = { x: 155, y: 300 }; // straight left: +90° counter-clockwise
    near(dragPlacement(img, "rotate", from, to, false), { rotation: 90, cx: 200, cy: 300 });
    expect(dragPlacement(img, "rotate", from, { x: 190, y: 345 }, true).rotation).toBe(15);
  });

  it("sizes new images at 96 dpi, at most half the page wide", () => {
    expect(naturalSize({ width: 200, height: 100 }, 612)).toEqual({ width: 150, height: 75 });
    const big = naturalSize({ width: 2000, height: 1000 }, 612);
    expect(big.width).toBeCloseTo(306);
    expect(big.height).toBeCloseTo(153);
  });
});
