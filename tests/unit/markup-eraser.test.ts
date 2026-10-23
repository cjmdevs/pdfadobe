import { describe, expect, it } from "vitest";
import { eraseStrokes, inkRect } from "../../src/markup/eraser";

const line = (x0: number, x1: number, y = 100) => [
  { x: x0, y },
  { x: x1, y },
];

describe("ink eraser", () => {
  it("leaves strokes the eraser did not touch alone", () => {
    expect(eraseStrokes([line(0, 100)], [{ x: 50, y: 150 }], 5)).toBeNull();
  });

  it("cuts a straight stroke in two where the eraser crosses it", () => {
    const out = eraseStrokes(
      [line(0, 100)],
      [
        { x: 50, y: 80 },
        { x: 50, y: 120 },
      ],
      5,
    )!;
    expect(out).toHaveLength(2);
    // Left piece ends just before x = 45, right piece starts just after x = 55.
    expect(out[0]![0]).toEqual({ x: 0, y: 100 });
    expect(out[0]!.at(-1)!.x).toBeLessThan(45);
    expect(out[0]!.at(-1)!.x).toBeGreaterThan(40);
    expect(out[1]![0]!.x).toBeGreaterThan(55);
    expect(out[1]!.at(-1)).toEqual({ x: 100, y: 100 });
  });

  it("keeps only the drawn points plus the cut ends (no densified points)", () => {
    const out = eraseStrokes([line(0, 100)], [{ x: 100, y: 100 }], 2)!;
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2);
  });

  it("the pen's own width counts: a thick stroke is hit from further away", () => {
    const eraser = [{ x: 50, y: 106 }];
    expect(eraseStrokes([line(0, 100)], eraser, 3, 1)).toBeNull();
    expect(eraseStrokes([line(0, 100)], eraser, 3, 8)).not.toBeNull();
  });

  it("erasing a whole stroke removes it; other strokes stay", () => {
    const out = eraseStrokes([line(0, 4), line(0, 100, 300)], [{ x: 2, y: 100 }], 5)!;
    expect(out).toEqual([line(0, 100, 300)]);
    expect(eraseStrokes([line(0, 4)], [{ x: 2, y: 100 }], 5)).toEqual([]);
  });

  it("inkRect covers every point plus half the pen width", () => {
    expect(inkRect([line(10, 20, 30)], 4)).toEqual({
      origin: { x: 7, y: 27 },
      size: { width: 16, height: 6 },
    });
  });
});
