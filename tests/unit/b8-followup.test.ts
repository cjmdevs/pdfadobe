// Logic behind the owner findings after the B8 review fixes.
import { describe, expect, it } from "vitest";
import { shownSize } from "../../src/app/pageSize";
import {
  SHOT_MAX_SCALE,
  SHOT_PAD,
  shotArea,
  shotScale,
  toPageRect,
} from "../../src/ui/edit/snapshot";
import { wheelTurn } from "../../src/app/wheelTurn";

describe("the wheel in Single page view", () => {
  it("turns the page either way when the page fits", () => {
    const fits = { top: 0, height: 600, client: 600 };
    expect(wheelTurn(100, fits)).toBe(1);
    expect(wheelTurn(-100, fits)).toBe(-1);
    expect(wheelTurn(0, fits)).toBe(0);
  });

  it("scrolls a tall page first and turns only at its ends", () => {
    expect(wheelTurn(100, { top: 0, height: 1500, client: 600 })).toBe(0);
    expect(wheelTurn(100, { top: 400, height: 1500, client: 600 })).toBe(0);
    expect(wheelTurn(100, { top: 900, height: 1500, client: 600 })).toBe(1);
    expect(wheelTurn(-100, { top: 400, height: 1500, client: 600 })).toBe(0);
    expect(wheelTurn(-100, { top: 0, height: 1500, client: 600 })).toBe(-1);
  });

  it("counts a fraction of a pixel short of the end as the end (zoomed layouts)", () => {
    expect(wheelTurn(100, { top: 899.4, height: 1500, client: 600 })).toBe(1);
    expect(wheelTurn(-100, { top: 0.6, height: 1500, client: 600 })).toBe(-1);
  });
});

describe("the room a page takes on screen", () => {
  const letter = { width: 612, height: 792 };

  it("is its size times the zoom", () => {
    expect(shownSize(letter, 0, 1.5)).toEqual({ width: 918, height: 1188 });
    expect(shownSize(letter, 2, 1)).toEqual(letter);
  });

  it("swaps width and height for a quarter turn either way", () => {
    expect(shownSize(letter, 1, 1)).toEqual({ width: 792, height: 612 });
    expect(shownSize(letter, 3, 2)).toEqual({ width: 1584, height: 1224 });
    // Page rotation plus view rotation can pass a full turn.
    expect(shownSize(letter, 5, 1)).toEqual({ width: 792, height: 612 });
  });
});

describe("the picture of a dragged text box or image", () => {
  const page = { width: 612, height: 792 };

  it("takes the box plus a little room", () => {
    expect(shotArea({ l: 100, b: 500, r: 300, t: 540 }, page)).toEqual({
      l: 100 - SHOT_PAD,
      b: 500 - SHOT_PAD,
      r: 300 + SHOT_PAD,
      t: 540 + SHOT_PAD,
    });
  });

  it("stays on the page, and is nothing for a box that is off it", () => {
    expect(shotArea({ l: -20, b: 780, r: 50, t: 800 }, page)).toEqual({
      l: 0,
      b: 778,
      r: 52,
      t: 792,
    });
    expect(shotArea({ l: 700, b: 10, r: 760, t: 40 }, page)).toBeNull();
  });

  it("hands the renderer a top-left rectangle", () => {
    expect(toPageRect({ l: 100, b: 500, r: 300, t: 540 }, 792)).toEqual({
      origin: { x: 100, y: 252 },
      size: { width: 200, height: 40 },
    });
  });

  it("is drawn at the zoom on screen, up to a cap", () => {
    expect(shotScale(1.5, 1)).toEqual({ scaleFactor: 1.5, dpr: 1 });
    expect(shotScale(1.5, 2)).toEqual({ scaleFactor: 1.5, dpr: 2 });
    // 64x zoom on a 2x screen: capped so the picture stays small.
    const big = shotScale(64, 2);
    expect(big.scaleFactor * big.dpr).toBe(SHOT_MAX_SCALE);
    // A screen density under 1 (browser zoomed out) never blurs it below 1.
    expect(shotScale(1, 0.5)).toEqual({ scaleFactor: 1, dpr: 1 });
  });
});
