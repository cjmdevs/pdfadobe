import { describe, expect, it } from "vitest";
import {
  MAX_PINNED,
  MAX_RECENT,
  clearRecent,
  displayOrder,
  dropThumbs,
  folderOf,
  removeRecentFile,
  sanitizeRecent,
  setPinned,
  setThumb,
  touchRecent,
  type RecentFile,
} from "../../src/app/recent";

const id = (n: number) => n.toString(16).padStart(32, "0");
const entry = (path: string, extra: Partial<RecentFile> = {}): RecentFile => ({
  path,
  opened: 1,
  pinned: false,
  thumb: null,
  ...extra,
});

describe("recent files (B2)", () => {
  it("reads the old list of plain paths", () => {
    expect(sanitizeRecent(["C:\\a.pdf", "c:/A.PDF", "D:\\b.pdf", 5])).toEqual([
      entry("C:\\a.pdf", { opened: 0 }),
      entry("D:\\b.pdf", { opened: 0 }),
    ]);
  });

  it("drops junk fields and bad thumbnail ids", () => {
    const [e] = sanitizeRecent([{ path: "C:\\a.pdf", opened: "x", pinned: 1, thumb: "../x" }]);
    expect(e).toEqual(entry("C:\\a.pdf", { opened: 0 }));
  });

  it("moves an opened file to the top and keeps its pin and thumbnail", () => {
    let list = [entry("C:\\a.pdf"), entry("C:\\b.pdf", { pinned: true, thumb: id(1) })];
    list = touchRecent(list, "c:\\B.pdf", 99).list;
    expect(list[0]).toEqual({ path: "c:\\B.pdf", opened: 99, pinned: true, thumb: id(1) });
    expect(list).toHaveLength(2);
  });

  it("caps unpinned files and reports the thumbnails that fell off", () => {
    let list = setPinned(touchRecent([], "C:\\f0.pdf", 0).list, "C:\\f0.pdf", true).list;
    for (let i = 1; i <= MAX_RECENT; i++)
      list = setThumb(touchRecent(list, `C:\\f${i}.pdf`, i).list, `C:\\f${i}.pdf`, id(i)).list;
    const change = touchRecent(list, "C:\\new.pdf", 100);
    expect(change.list).toHaveLength(MAX_RECENT + 1); // the pinned one does not count
    expect(change.dropped).toEqual([id(1)]);
    expect(change.list.some((e) => e.path === "C:\\f0.pdf")).toBe(true);
  });

  it("refuses to pin more than MAX_PINNED", () => {
    let list: RecentFile[] = [];
    for (let i = 0; i <= MAX_PINNED; i++)
      list = [entry(`C:\\p${i}.pdf`, { pinned: i < MAX_PINNED }), ...list];
    expect(setPinned(list, `C:\\p${MAX_PINNED}.pdf`, true).list).toBe(list);
  });

  it("returns thumbnails on remove, clear, replace and thumbnails off", () => {
    const list = [entry("C:\\a.pdf", { thumb: id(1) }), entry("C:\\b.pdf", { thumb: id(2) })];
    expect(removeRecentFile(list, "C:\\A.pdf")).toEqual({ list: [list[1]], dropped: [id(1)] });
    expect(clearRecent(list)).toEqual({ list: [], dropped: [id(1), id(2)] });
    expect(setThumb(list, "C:\\a.pdf", id(3)).dropped).toEqual([id(1)]);
    expect(setThumb(list, "C:\\gone.pdf", id(3)).dropped).toEqual([id(3)]);
    const off = dropThumbs(list);
    expect(off.dropped).toEqual([id(1), id(2)]);
    expect(off.list.every((e) => e.thumb === null)).toBe(true);
  });

  it("shows pinned files first", () => {
    const list = [entry("C:\\a.pdf"), entry("C:\\b.pdf", { pinned: true })];
    expect(displayOrder(list).map((e) => e.path)).toEqual(["C:\\b.pdf", "C:\\a.pdf"]);
  });

  it("finds the folder of local and UNC paths", () => {
    expect(folderOf("C:\\Clients\\AB\\r.pdf")).toBe("C:\\Clients\\AB");
    expect(folderOf("\\\\server\\share\\r.pdf")).toBe("\\\\server\\share");
    expect(folderOf("r.pdf")).toBe("");
  });
});
