import { describe, expect, it } from "vitest";
import { EditHistory } from "../../src/app/history";

const b = (n: number, size = 10) => new Uint8Array(size).fill(n);

describe("EditHistory", () => {
  it("undoes and redoes, and a new edit clears redo", () => {
    const h = new EditHistory(b(0));
    h.push(b(1), "Rotate");
    h.push(b(2), "Delete pages");
    expect(h.undoLabel).toBe("Delete pages");
    expect(h.undo()?.[0]).toBe(1);
    expect(h.redoLabel).toBe("Delete pages");
    expect(h.redo()?.[0]).toBe(2);
    expect(h.redo()).toBeNull();
    h.undo();
    h.push(b(3), "Move pages");
    expect(h.redoLabel).toBeNull();
    expect(h.current[0]).toBe(3);
    h.undo();
    h.undo();
    expect(h.undo()).toBeNull();
    expect(h.current[0]).toBe(0);
  });

  it("tracks unsaved changes, including undo back to the saved state", () => {
    const h = new EditHistory(b(0));
    expect(h.dirty).toBe(false);
    h.push(b(1), "Rotate");
    expect(h.dirty).toBe(true);
    h.markSaved();
    expect(h.dirty).toBe(false);
    h.undo();
    expect(h.dirty).toBe(true);
    h.redo();
    expect(h.dirty).toBe(false);
    // Saved state discarded by a new branch: dirty for good.
    h.undo();
    h.push(b(2), "Delete");
    h.undo();
    h.redo();
    expect(h.dirty).toBe(true);
    expect(new EditHistory(b(0), undefined, false).dirty).toBe(true);
  });

  it("drops the oldest steps to stay under the memory cap", () => {
    const h = new EditHistory(b(0, 100), 350);
    for (let i = 1; i <= 5; i++) h.push(b(i, 100), `Step ${i}`);
    expect(h.totalBytes).toBeLessThanOrEqual(350);
    expect(h.trimmed).toBe(true);
    expect(h.current[0]).toBe(5);
    expect(h.undo()?.[0]).toBe(4);
    expect(h.undo()?.[0]).toBe(3);
    expect(h.undo()).toBeNull();
    // A single state larger than the cap is still kept (current must exist).
    const big = new EditHistory(b(0, 10), 5);
    big.push(b(1, 50), "Huge");
    expect(big.current[0]).toBe(1);
  });
});
