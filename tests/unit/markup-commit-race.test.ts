import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { installCommitRaceGuard } from "../../src/markup/commitRaceGuard";

describe("commit race guard", () => {
  it("only annotations unchanged since the batch started count as committed", () => {
    const state = { byUid: { a: { object: { v: 1 } }, b: { object: { v: 1 } } } };
    let seen: string[] = [];
    let finish: () => void = () => undefined;
    const plugin = {
      getDocumentState: () => state,
      executeCommitBatch(_d: string, _doc: unknown, batch: { committedUids: string[] }) {
        // Like the plugin: the list is read when the PDFium calls finish.
        finish = () => {
          seen = batch.committedUids;
        };
      },
    };
    expect(installCommitRaceGuard(plugin)).toBe(true);
    expect(installCommitRaceGuard(plugin)).toBe(true); // once only
    plugin.executeCommitBatch("doc", null, { committedUids: ["a", "b"] });
    state.byUid.b = { object: { v: 2 } }; // changed while the commit runs (Ctrl+Y)
    finish();
    expect(seen).toEqual(["a"]);
  });

  it("refuses to patch an object without the plugin's methods", () => {
    expect(installCommitRaceGuard({})).toBe(false);
    expect(installCommitRaceGuard(null)).toBe(false);
  });

  it("the pinned plugin still has the internals the guard relies on", () => {
    // The ES build the app bundles (next to the CommonJS entry Node resolves).
    const cjs = createRequire(import.meta.url).resolve("@embedpdf/plugin-annotation");
    const src = readFileSync(join(dirname(cjs), "index.js"), "utf8");
    expect(src).toContain("executeCommitBatch(docId, doc, batch)");
    expect(src).toContain("commitPendingChanges(docId, batch.committedUids)");
    expect(src).toContain("this.commitInProgress");
  });
});
