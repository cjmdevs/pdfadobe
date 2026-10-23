import { describe, expect, it } from "vitest";
import { MemoryDocStore } from "../../src/app/docstore";

const b = (n: number, size = 10) => new Uint8Array(size).fill(n);

describe("MemoryDocStore", () => {
  it("keeps history, dirty flag, path and signature consent per document", async () => {
    const s = new MemoryDocStore();
    await s.create("d1", b(0), { name: "a.pdf", path: "C:\\A\\a.pdf", saved: true });
    let i = await s.push("d1", b(1), "Rotate right");
    expect(i).toMatchObject({ dirty: true, undoLabel: "Rotate right", redoLabel: null });
    const u = await s.undo("d1");
    expect(u?.bytes[0]).toBe(0);
    expect(u?.info.dirty).toBe(false);
    expect((await s.redo("d1"))?.bytes[0]).toBe(1);
    i = await s.markSaved("d1", { path: "C:\\A\\b.pdf", name: "b.pdf" });
    expect(i).toMatchObject({ dirty: false, path: "C:\\A\\b.pdf", name: "b.pdf" });
    expect((await s.acceptSignature("d1")).signatureAccepted).toBe(true);
    expect((await s.current("d1"))[0]).toBe(1);
  });

  it("finds an open file by path (case and slash insensitive) and lists unsaved ones", async () => {
    const s = new MemoryDocStore();
    await s.create("d1", b(0), { name: "a.pdf", path: "C:\\A\\a.pdf", saved: true });
    await s.create("d2", b(0), { name: "Combined.pdf", path: null, saved: false });
    expect((await s.findPath("c:/a/A.PDF"))?.id).toBe("d1");
    expect(await s.findPath("C:\\A\\other.pdf")).toBeNull();
    expect((await s.dirty()).map((d) => d.id)).toEqual(["d2"]);
    await s.release("d2");
    expect(await s.dirty()).toEqual([]);
    await expect(s.info("d2")).rejects.toThrow(/not open/);
  });
});
