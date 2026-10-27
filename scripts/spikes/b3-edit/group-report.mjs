#!/usr/bin/env node
// Grouping check only: every sample in the given folders against its expected JSON.
// Prints pass/fail per file and each miss with what was found nearest to it.
//
// Usage: node scripts/spikes/b3-edit/group-report.mjs <folder> [<folder> ...]

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { loadPdfium, openDoc } from "./pdfium.mjs";
import { groupPage, scoreGrouping } from "./group.mjs";

const m = await loadPdfium();
let fails = 0;
for (const dir of process.argv.slice(2)) {
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".pdf"))
    .sort()) {
    const name = f.replace(/\.pdf$/, "");
    const expected = JSON.parse(readFileSync(join(dir, `${name}.expected.json`), "utf8"));
    const d = openDoc(m, readFileSync(join(dir, f)));
    const page = m.FPDF_LoadPage(d.doc, 0);
    const tp = m.FPDFText_LoadPage(page);
    const { boxes } = groupPage(m, page, tp);
    const score = scoreGrouping(boxes, expected);
    const misses = score.results.filter((r) => !r.ok);
    if (!score.ok) fails++;
    console.log(
      `${score.ok ? "PASS" : "FAIL"} ${basename(dir)}/${name}: ${expected.length - misses.length}/${expected.length}`,
    );
    for (const r of misses) {
      const want = r.text.slice(0, 24);
      const near = boxes
        .flatMap((b) => b.paragraphs)
        .filter((p) => p.text.includes(want.slice(0, 10)) || want.includes(p.text.slice(0, 10)))
        .map((p) => `"${p.text.slice(0, 70)}" (${p.lines.length})`);
      console.log(
        `   - want "${r.text.slice(0, 60)}" (${r.lines ?? "?"}) found: ${near.join(" | ") || "nothing"}`,
      );
    }
    m.FPDFText_ClosePage(tp);
    m.FPDF_ClosePage(page);
    d.close();
  }
}
process.exitCode = fails ? 1 : 0;
