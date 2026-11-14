// Logic behind the owner findings after the B8 review fixes.
import { describe, expect, it } from "vitest";
import { shownSize } from "../../src/app/pageSize";
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
