// Search & Redact over form-field values (B7 owner check). A field's value is not page
// text, so the page search cannot see it, and the leak scan then (rightly) refuses to
// save. A match marks the whole widget: Apply removes a field under a box whole
// (objects.ts). Shared by the app (page worker) and the MCP redact_patterns tool.
// Values are never logged.

import type { Engine } from "../pdfium";
import { withEngineDoc } from "../pages/outline-io";
import { pageWidgets } from "../forms/fields";
import { findMatches, type SearchSpec } from "./patterns";
import type { MarkCandidate } from "./search";

export async function searchFields(
  engine: Engine,
  bytes: Uint8Array,
  spec: SearchSpec,
  pages?: number[],
): Promise<MarkCandidate[]> {
  return withEngineDoc(engine, bytes, async (doc) => {
    const out: MarkCandidate[] = [];
    const list = pages ?? doc.pages.map((_, i) => i);
    for (const pageIndex of list) {
      const height = doc.pages[pageIndex]?.size.height ?? 0;
      for (const w of await pageWidgets(engine, doc, pageIndex)) {
        const value = w.field.value ?? "";
        if (!value) continue;
        const r = w.rect;
        for (const m of findMatches(value, spec)) {
          out.push({
            kind: "area",
            pageIndex,
            // Widget rect (top-left origin, engine) to PDF points (bottom-left).
            rects: [
              {
                l: r.origin.x,
                r: r.origin.x + r.size.width,
                t: height - r.origin.y,
                b: height - r.origin.y - r.size.height,
              },
            ],
            source: m.source,
            text: value.slice(m.start, m.end),
            inField: true,
          });
        }
      }
    }
    return out;
  });
}
