// Where redacted text is still stored when the leak scan refuses a save (B7 owner check),
// so the message can say "a form field on page 1" instead of "hidden data", and name
// the one fix that works there. Looks only at the objects' string values: anything
// else (page content, images, attachments) is "elsewhere". Never returns the text.

import { isRef, type JDict, type JVal, type PdfObjects } from "./objects";
import { jsonText, norm } from "./sanitize";

export interface LeakPlace {
  kind: "field" | "comment" | "bookmark" | "properties" | "elsewhere";
  /** 0-based page, for fields and comments that are on a page. */
  pageIndex?: number;
}

export function leakPlaces(objs: PdfObjects, secrets: string[]): LeakPlace[] {
  const keys = secrets.map(norm).filter((s) => s.length >= 4);
  const holds = (v: JVal | undefined): boolean => {
    const t = jsonText(objs.get(v));
    return t !== null && keys.some((k) => norm(t).includes(k));
  };
  const out: LeakPlace[] = [];
  const add = (p: LeakPlace) => {
    if (!out.some((o) => o.kind === p.kind && o.pageIndex === p.pageIndex)) out.push(p);
  };
  const seenFields = new Set<string>();

  // A field's value can sit on the widget or on its parent field.
  const fieldHolds = (d: JDict): boolean => {
    for (let cur: JDict | undefined = d, n = 0; cur && n < 10; n++) {
      if (holds(cur["/V"]) || holds(cur["/DV"])) return true;
      cur = objs.dict(cur["/Parent"]);
    }
    return false;
  };

  objs.pages().forEach((pageRef, pageIndex) => {
    const annots = objs.get(objs.dict(pageRef)?.["/Annots"]);
    if (!Array.isArray(annots)) return;
    for (const a of annots) {
      const d = objs.dict(a);
      if (!d) continue;
      if (d["/Subtype"] === "/Widget" || "/FT" in d) {
        if (isRef(a)) seenFields.add(a);
        if (fieldHolds(d)) add({ kind: "field", pageIndex });
      } else if (holds(d["/Contents"]) || holds(d["/RC"]) || holds(d["/T"])) {
        add({ kind: "comment", pageIndex });
      }
    }
  });

  // Fields with no widget on any page.
  const walkFields = (list: JVal | undefined, depth = 0) => {
    const arr = objs.get(list);
    if (!Array.isArray(arr) || depth > 10) return;
    for (const f of arr) {
      if (isRef(f) && seenFields.has(f)) continue;
      const d = objs.dict(f);
      if (!d) continue;
      if (holds(d["/V"]) || holds(d["/DV"])) add({ kind: "field" });
      walkFields(d["/Kids"], depth + 1);
    }
  };
  walkFields(objs.dict(objs.catalog["/AcroForm"])?.["/Fields"]);

  // Bookmark titles.
  const seen = new Set<string>();
  const walkOutline = (item: JVal | undefined) => {
    for (let cur = item; isRef(cur) && !seen.has(cur);) {
      seen.add(cur);
      const d = objs.dict(cur);
      if (!d) break;
      if (holds(d["/Title"])) add({ kind: "bookmark" });
      walkOutline(d["/First"]);
      cur = d["/Next"];
    }
  };
  walkOutline(objs.dict(objs.catalog["/Outlines"])?.["/First"]);

  const info = objs.dict(objs.trailer["/Info"]);
  if (info && Object.values(info).some((v) => holds(v))) add({ kind: "properties" });

  return out.length ? out : [{ kind: "elsewhere" }];
}
