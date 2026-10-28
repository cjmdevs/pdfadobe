// B3 stage 2: a text box's frame (padding, auto-fit, fixed height) and what dragging a
// handle or typing in X/Y/W/H means for the text.
import { describe, expect, it } from "vitest";
import type { EditTextBox } from "../../src/engine/edit";
import { DEFAULT_FRAME } from "../../src/ui/edit/editStore";
import {
  dragEdge,
  edgeAt,
  frameChange,
  frameOf,
  fromInches,
  overfull,
  toInches,
} from "../../src/ui/edit/frame";

// Text from x 100-300, y 500-540 (editPageInfo's rect has a point of air around it).
const box = { rect: { l: 99, r: 301, b: 499, t: 541 } } as EditTextBox;

describe("text box frame", () => {
  it("is the text plus padding; a fixed height hangs from the top", () => {
    expect(frameOf(box, DEFAULT_FRAME)).toEqual({ l: 99, r: 301, b: 499, t: 541 });
    expect(frameOf(box, { ...DEFAULT_FRAME, padding: 5 })).toEqual({
      l: 95,
      r: 305,
      b: 495,
      t: 545,
    });
    const fixed = { autoFit: false, height: 20, padding: 1 };
    expect(frameOf(box, fixed)).toEqual({ l: 99, r: 301, b: 521, t: 541 });
    expect(overfull(box, fixed)).toBe(true);
    expect(overfull(box, { ...fixed, height: 60 })).toBe(false);
    expect(overfull(box, DEFAULT_FRAME)).toBe(false);
  });

  it("turns a frame change into a move, a re-wrap or a height", () => {
    const f = { ...DEFAULT_FRAME, padding: 4 };
    const now = frameOf(box, f);
    // Same size elsewhere: a move.
    expect(frameChange(box, f, { ...now, l: now.l + 10, r: now.r + 10 })).toEqual({ dx: 10 });
    expect(frameChange(box, f, { ...now, t: now.t - 7, b: now.b - 7 })).toEqual({ dy: -7 });
    // Narrower from the left: re-wrap at the new left edge, inside the padding.
    expect(frameChange(box, f, { ...now, l: now.l + 50 })).toEqual({
      rewrap: { left: now.l + 50 + 4, width: now.r - now.l - 50 - 8 },
    });
    // Bottom handle: a fixed height.
    expect(frameChange(box, f, { ...now, b: now.b - 30 })).toEqual({
      height: now.t - now.b + 30,
    });
    // Top handle: the text moves down and the height shrinks.
    expect(frameChange(box, f, { ...now, t: now.t - 10 })).toEqual({
      dy: -10,
      height: now.t - now.b - 10,
    });
  });

  it("finds the handle under the pointer and drags it", () => {
    const fr = frameOf(box, DEFAULT_FRAME);
    expect(edgeAt(fr, { x: 99, y: 541 }, 3)).toBe("nw");
    expect(edgeAt(fr, { x: 200, y: 499 }, 3)).toBe("s");
    expect(edgeAt(fr, { x: 301, y: 520 }, 3)).toBe("e");
    expect(edgeAt(fr, { x: 200, y: 520 }, 3)).toBeNull();
    expect(dragEdge(fr, "se", { x: 350, y: 450 })).toEqual({ l: 99, r: 350, b: 450, t: 541 });
    // Never narrower than 12 points or flatter than 4.
    expect(dragEdge(fr, "w", { x: 400, y: 0 }).l).toBe(301 - 12);
    expect(dragEdge(fr, "n", { x: 0, y: 0 }).t).toBe(499 + 4);
  });

  it("shows inches", () => {
    expect(toInches(72)).toBe(1);
    expect(toInches(100)).toBe(1.39);
    expect(fromInches(1.5)).toBe(108);
  });
});
