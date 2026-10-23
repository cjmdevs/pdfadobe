// XFDF export/import of markup (Phase 3). EmbedPDF has no XFDF support, so this maps its
// annotation objects to ISO 19444-1 (XFDF 3.0) elements, the format Acrobat's
// Comments > Export/Import uses. Node-safe (no DOM): fast-xml-parser reads it.
//
// Coordinates: XFDF uses PDF user space (bottom-left origin); EmbedPDF uses page space
// with a top-left origin, so every y is flipped with the page height.
//
// Not carried: stamp appearances. Our built-in stamps are recognised by subject on
// import and drawn again; other stamps import as plain stamps (see docs/progress.md).

import { XMLParser } from "fast-xml-parser";
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationLineEnding,
  PdfAnnotationName,
  PdfAnnotationReplyType,
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfAnnotationFlagName,
  type PdfAnnotationObject,
  type Position,
  type Rect,
} from "@embedpdf/models";

const ELEMENT: Partial<Record<PdfAnnotationSubtype, string>> = {
  [PdfAnnotationSubtype.TEXT]: "text",
  [PdfAnnotationSubtype.FREETEXT]: "freetext",
  [PdfAnnotationSubtype.HIGHLIGHT]: "highlight",
  [PdfAnnotationSubtype.UNDERLINE]: "underline",
  [PdfAnnotationSubtype.STRIKEOUT]: "strikeout",
  [PdfAnnotationSubtype.SQUIGGLY]: "squiggly",
  [PdfAnnotationSubtype.SQUARE]: "square",
  [PdfAnnotationSubtype.CIRCLE]: "circle",
  [PdfAnnotationSubtype.LINE]: "line",
  [PdfAnnotationSubtype.POLYLINE]: "polyline",
  [PdfAnnotationSubtype.POLYGON]: "polygon",
  [PdfAnnotationSubtype.INK]: "ink",
  [PdfAnnotationSubtype.STAMP]: "stamp",
  [PdfAnnotationSubtype.CARET]: "caret",
};
const SUBTYPE = Object.fromEntries(
  Object.entries(ELEMENT).map(([k, v]) => [v, Number(k) as PdfAnnotationSubtype]),
) as Record<string, PdfAnnotationSubtype>;

const LINE_ENDINGS: Record<number, string> = {
  [PdfAnnotationLineEnding.None]: "None",
  [PdfAnnotationLineEnding.Square]: "Square",
  [PdfAnnotationLineEnding.Circle]: "Circle",
  [PdfAnnotationLineEnding.Diamond]: "Diamond",
  [PdfAnnotationLineEnding.OpenArrow]: "OpenArrow",
  [PdfAnnotationLineEnding.ClosedArrow]: "ClosedArrow",
  [PdfAnnotationLineEnding.Butt]: "Butt",
  [PdfAnnotationLineEnding.ROpenArrow]: "ROpenArrow",
  [PdfAnnotationLineEnding.RClosedArrow]: "RClosedArrow",
  [PdfAnnotationLineEnding.Slash]: "Slash",
};
const LINE_ENDING_OF = Object.fromEntries(
  Object.entries(LINE_ENDINGS).map(([k, v]) => [v.toLowerCase(), Number(k)]),
) as Record<string, PdfAnnotationLineEnding>;

const FLAGS: PdfAnnotationFlagName[] = [
  "invisible",
  "hidden",
  "print",
  "noZoom",
  "noRotate",
  "noView",
  "readOnly",
  "locked",
  "toggleNoView",
  "lockedContents",
];

/** PDF font names PDFium uses in /DA for the standard fonts. */
const FONT_DA: Partial<Record<PdfStandardFont, string>> = {
  [PdfStandardFont.Helvetica]: "Helv",
  [PdfStandardFont.Helvetica_Bold]: "HeBo",
  [PdfStandardFont.Helvetica_Oblique]: "HeOb",
  [PdfStandardFont.Helvetica_BoldOblique]: "HeBO",
  [PdfStandardFont.Times_Roman]: "TiRo",
  [PdfStandardFont.Times_Bold]: "TiBo",
  [PdfStandardFont.Times_Italic]: "TiIt",
  [PdfStandardFont.Times_BoldItalic]: "TiBI",
  [PdfStandardFont.Courier]: "Cour",
  [PdfStandardFont.Courier_Bold]: "CoBo",
  [PdfStandardFont.Courier_Oblique]: "CoOb",
  [PdfStandardFont.Courier_BoldOblique]: "CoBO",
  [PdfStandardFont.Symbol]: "Symb",
  [PdfStandardFont.ZapfDingbats]: "ZaDb",
};
const FONT_OF = Object.fromEntries(
  Object.entries(FONT_DA).map(([k, v]) => [v.toLowerCase(), Number(k)]),
) as Record<string, PdfStandardFont>;

// ---- export -------------------------------------------------------------------

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 has no place for other control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** PDF date string, UTC: D:20261023090000Z. */
export function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function parsePdfDate(s: string | undefined): Date | undefined {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(
    s?.trim() ?? "",
  );
  if (!m) return undefined;
  const [
    ,
    y = "1970",
    mo = "01",
    d = "01",
    h = "00",
    mi = "00",
    se = "00",
    tz,
    th = "00",
    tm = "00",
  ] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  if (tz === "+" || tz === "-") ms -= (tz === "+" ? 1 : -1) * (+th * 60 + +tm) * 60_000;
  return new Date(ms);
}

function hexColor(c: unknown): string | null {
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : null;
}

/**
 * XFDF for `annots` (EmbedPDF objects from any pages). `pageHeights[i]` is page i's
 * height in points; `fileName` goes in <f href>.
 */
export function exportXfdf(
  annots: PdfAnnotationObject[],
  pageHeights: number[],
  fileName: string,
): string {
  const out: string[] = [];
  for (const a of annots) {
    const el = ELEMENT[a.type];
    const h = pageHeights[a.pageIndex];
    if (!el || h === undefined) continue;
    const o = a as unknown as Record<string, unknown>;
    const y = (v: number) => num(h - v);
    const pt = (p: Position) => `${num(p.x)},${y(p.y)}`;
    const { origin: r0, size: rs } = a.rect;
    const attrs: Record<string, string | undefined> = {
      page: String(a.pageIndex),
      rect: `${num(r0.x)},${y(r0.y + rs.height)},${num(r0.x + rs.width)},${y(r0.y)}`,
      name: a.id,
      title: a.author,
      subject: a.subject,
      date: a.modified ? pdfDate(a.modified) : undefined,
      creationdate: a.created ? pdfDate(a.created) : undefined,
      flags: a.flags?.length ? a.flags.map((f) => f.toLowerCase()).join(",") : undefined,
      opacity: typeof o.opacity === "number" && o.opacity !== 1 ? num(o.opacity) : undefined,
      inreplyto: a.inReplyToId,
      replyType:
        a.inReplyToId && a.replyType === PdfAnnotationReplyType.Group ? "group" : undefined,
      intent: a.intent,
    };
    const kids: string[] = [];
    if (a.contents) kids.push(`<contents>${esc(a.contents)}</contents>`);
    const stroke = hexColor(o.strokeColor ?? o.color);
    switch (a.type) {
      case PdfAnnotationSubtype.TEXT:
        attrs.color = stroke ?? undefined;
        if (typeof o.name === "number" && o.name >= 0)
          attrs.icon = PdfAnnotationName[o.name as PdfAnnotationName];
        if (typeof o.state === "string") attrs.state = o.state;
        if (typeof o.stateModel === "string") attrs.statemodel = o.stateModel;
        break;
      case PdfAnnotationSubtype.FREETEXT: {
        const fill = hexColor(o.color ?? o.backgroundColor);
        attrs.color = fill ?? undefined;
        if (typeof o.strokeWidth === "number") attrs.width = num(o.strokeWidth);
        if (Array.isArray(o.calloutLine))
          attrs.callout = (o.calloutLine as Position[]).map(pt).join(",");
        if (typeof o.lineEnding === "number") attrs.head = LINE_ENDINGS[o.lineEnding];
        attrs.justification = String(o.textAlign ?? 0);
        const fc = hexColor(o.fontColor) ?? "#000000";
        const [cr = 0, cg = 0, cb = 0] = [1, 3, 5].map(
          (i) => parseInt(fc.slice(i, i + 2), 16) / 255,
        );
        const font = FONT_DA[o.fontFamily as PdfStandardFont] ?? "Helv";
        kids.push(
          `<defaultappearance>${num(cr)} ${num(cg)} ${num(cb)} rg /${font} ${num(Number(o.fontSize ?? 12))} Tf</defaultappearance>`,
        );
        if (stroke && o.strokeColor)
          kids.push(`<defaultstyle>border-color:${stroke}</defaultstyle>`);
        break;
      }
      case PdfAnnotationSubtype.HIGHLIGHT:
      case PdfAnnotationSubtype.UNDERLINE:
      case PdfAnnotationSubtype.STRIKEOUT:
      case PdfAnnotationSubtype.SQUIGGLY:
        attrs.color = stroke ?? undefined;
        attrs.coords = ((o.segmentRects as Rect[] | undefined) ?? [a.rect])
          .flatMap((s) => {
            const x0 = s.origin.x;
            const x1 = s.origin.x + s.size.width;
            const top = s.origin.y;
            const bot = s.origin.y + s.size.height;
            // QuadPoints order: top-left, top-right, bottom-left, bottom-right.
            return [x0, top, x1, top, x0, bot, x1, bot].map((v, i) => (i % 2 ? y(v) : num(v)));
          })
          .join(",");
        break;
      case PdfAnnotationSubtype.SQUARE:
      case PdfAnnotationSubtype.CIRCLE:
      case PdfAnnotationSubtype.POLYGON:
      case PdfAnnotationSubtype.POLYLINE:
      case PdfAnnotationSubtype.LINE: {
        attrs.color = hexColor(o.strokeColor) ?? undefined;
        const fill = hexColor(o.color);
        if (fill) attrs["interior-color"] = fill;
        if (typeof o.strokeWidth === "number") attrs.width = num(o.strokeWidth);
        const cloudy = ((o.cloudyBorderIntensity as number | undefined) ?? 0) > 0;
        if (cloudy) {
          attrs.style = "cloudy";
          attrs.intensity = num(o.cloudyBorderIntensity as number);
        } else if (o.strokeStyle === PdfAnnotationBorderStyle.DASHED) {
          attrs.style = "dash";
          attrs.dashes = ((o.strokeDashArray as number[] | undefined) ?? [3, 3]).map(num).join(",");
        }
        if (a.type === PdfAnnotationSubtype.LINE) {
          const lp = o.linePoints as { start: Position; end: Position };
          attrs.start = pt(lp.start);
          attrs.end = pt(lp.end);
        }
        if (a.type === PdfAnnotationSubtype.POLYGON || a.type === PdfAnnotationSubtype.POLYLINE)
          kids.push(`<vertices>${(o.vertices as Position[]).map(pt).join(";")}</vertices>`);
        const le = o.lineEndings as { start: number; end: number } | undefined;
        if (le) {
          attrs.head = LINE_ENDINGS[le.start];
          attrs.tail = LINE_ENDINGS[le.end];
        }
        break;
      }
      case PdfAnnotationSubtype.INK:
        attrs.color = stroke ?? undefined;
        if (typeof o.strokeWidth === "number") attrs.width = num(o.strokeWidth);
        kids.push(
          `<inklist>${(o.inkList as { points: Position[] }[])
            .map((g) => `<gesture>${g.points.map(pt).join(";")}</gesture>`)
            .join("")}</inklist>`,
        );
        break;
      case PdfAnnotationSubtype.STAMP:
        if (typeof o.name === "number" && o.name >= 0)
          attrs.icon = PdfAnnotationName[o.name as PdfAnnotationName];
        break;
    }
    const attrText = Object.entries(attrs)
      .filter((e): e is [string, string] => e[1] !== undefined && e[1] !== "")
      .map(([k, v]) => ` ${k}="${esc(v)}"`)
      .join("");
    out.push(`<${el}${attrText}>${kids.join("")}</${el}>`);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">\n` +
    `<annots>\n${out.join("\n")}\n</annots>\n` +
    `<f href="${esc(fileName)}"/>\n</xfdf>\n`
  );
}

// ---- import -------------------------------------------------------------------

type Attrs = Record<string, unknown>;

const numbers = (s: unknown): number[] =>
  String(s ?? "")
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);

const textOf = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "object") return textOf((v as Attrs)["#text"]);
  return String(v);
};

function parseColor(s: unknown): string | undefined {
  const t = String(s ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(t) ? t.toUpperCase() : undefined;
}

export class XfdfError extends Error {}

/**
 * Annotations from an XFDF document, in EmbedPDF page space. Annotations on pages the
 * document does not have are skipped (counted in `skipped`).
 */
export function parseXfdf(
  xml: string,
  pageHeights: number[],
): { annotations: PdfAnnotationObject[]; skipped: number } {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
    removeNSPrefix: true,
    processEntities: true,
    isArray: (name) => name in SUBTYPE || name === "gesture",
  });
  let doc: Attrs;
  try {
    doc = parser.parse(xml) as Attrs;
  } catch (e) {
    throw new XfdfError(`not a valid XFDF file (${e instanceof Error ? e.message : String(e)})`);
  }
  const root = doc.xfdf as Attrs | undefined;
  if (!root) throw new XfdfError("not an XFDF file (no <xfdf> element)");
  const annots = (root.annots ?? {}) as Attrs;
  const out: PdfAnnotationObject[] = [];
  let skipped = 0;
  for (const [el, list] of Object.entries(annots)) {
    const type = SUBTYPE[el];
    if (type === undefined || !Array.isArray(list)) continue;
    for (const n of list as Attrs[]) {
      const pageIndex = Number(n.page);
      const h = pageHeights[pageIndex];
      const r = numbers(n.rect);
      if (!Number.isInteger(pageIndex) || h === undefined || r.length !== 4) {
        skipped++;
        continue;
      }
      const flip = (v: number) => h - v;
      const pos = (x: number, yy: number): Position => ({ x, y: flip(yy) });
      const pairs = (s: unknown): Position[] => {
        const v = numbers(s);
        const pts: Position[] = [];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push(pos(v[i] ?? 0, v[i + 1] ?? 0));
        return pts;
      };
      const [x0, y0, x1, y1] = r as [number, number, number, number];
      const rect: Rect = {
        origin: { x: Math.min(x0, x1), y: flip(Math.max(y0, y1)) },
        size: { width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) },
      };
      const flags = String(n.flags ?? "print")
        .split(",")
        .map((f) => f.trim().toLowerCase())
        .map((f) => FLAGS.find((k) => k.toLowerCase() === f))
        .filter((f): f is PdfAnnotationFlagName => f !== undefined);
      const opacity = n.opacity === undefined ? 1 : Number(n.opacity);
      const base: Attrs = {
        type,
        id: textOf(n.name) || crypto.randomUUID(),
        pageIndex,
        rect,
        contents: textOf(n.contents) ?? textOf(n["contents-richtext"]),
        author: textOf(n.title),
        subject: textOf(n.subject),
        modified: parsePdfDate(textOf(n.date)),
        created: parsePdfDate(textOf(n.creationdate)),
        flags,
        intent: textOf(n.intent),
        inReplyToId: textOf(n.inreplyto),
        replyType:
          n.inreplyto === undefined
            ? undefined
            : String(n.replyType ?? "reply").toLowerCase() === "group"
              ? PdfAnnotationReplyType.Group
              : PdfAnnotationReplyType.Reply,
        opacity: Number.isFinite(opacity) ? opacity : 1,
      };
      const color = parseColor(n.color);
      const fill = parseColor(n["interior-color"]);
      const width = n.width === undefined ? undefined : Number(n.width);
      const style = String(n.style ?? "solid").toLowerCase();
      const lineEnd = (v: unknown) => LINE_ENDING_OF[String(v ?? "None").toLowerCase()] ?? 0;
      switch (type) {
        case PdfAnnotationSubtype.TEXT: {
          const icon = PdfAnnotationName[textOf(n.icon) as keyof typeof PdfAnnotationName];
          Object.assign(base, {
            strokeColor: color ?? "#FFFF00",
            name: typeof icon === "number" ? icon : PdfAnnotationName.Comment,
            contents: base.contents ?? "",
            ...(n.state !== undefined
              ? { state: textOf(n.state), stateModel: textOf(n.statemodel) ?? "Review" }
              : {}),
          });
          break;
        }
        case PdfAnnotationSubtype.FREETEXT: {
          const da = textOf(n.defaultappearance) ?? "";
          const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
          const tf = /\/(\w+)\s+([\d.]+)\s+Tf/.exec(da);
          const hex = (v: string | undefined) =>
            Math.round(Number(v ?? 0) * 255)
              .toString(16)
              .padStart(2, "0");
          const border = /border-color:\s*(#[0-9a-f]{6})/i.exec(textOf(n.defaultstyle) ?? "");
          Object.assign(base, {
            contents: base.contents ?? "",
            fontColor: rg ? `#${hex(rg[1])}${hex(rg[2])}${hex(rg[3])}`.toUpperCase() : "#000000",
            fontFamily: (tf && FONT_OF[(tf[1] ?? "").toLowerCase()]) ?? PdfStandardFont.Helvetica,
            fontSize: tf ? Number(tf[2]) : 12,
            textAlign: Number(n.justification ?? 0) as PdfTextAlignment,
            verticalAlign: PdfVerticalAlignment.Top,
            color: color ?? "transparent",
            ...(width !== undefined ? { strokeWidth: width } : {}),
            ...(border ? { strokeColor: (border[1] ?? "").toUpperCase() } : {}),
            ...(n.callout !== undefined
              ? { calloutLine: pairs(n.callout), lineEnding: lineEnd(n.head) }
              : {}),
          });
          break;
        }
        case PdfAnnotationSubtype.HIGHLIGHT:
        case PdfAnnotationSubtype.UNDERLINE:
        case PdfAnnotationSubtype.STRIKEOUT:
        case PdfAnnotationSubtype.SQUIGGLY: {
          const q = numbers(n.coords);
          const segs: Rect[] = [];
          for (let i = 0; i + 7 < q.length; i += 8) {
            const at = (k: number) => q[i + k] ?? 0;
            const xs = [at(0), at(2), at(4), at(6)];
            const ys = [at(1), at(3), at(5), at(7)];
            segs.push({
              origin: { x: Math.min(...xs), y: flip(Math.max(...ys)) },
              size: {
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys),
              },
            });
          }
          Object.assign(base, {
            strokeColor: color ?? "#FFFF00",
            segmentRects: segs.length ? segs : [rect],
          });
          break;
        }
        case PdfAnnotationSubtype.SQUARE:
        case PdfAnnotationSubtype.CIRCLE:
        case PdfAnnotationSubtype.POLYGON:
        case PdfAnnotationSubtype.POLYLINE:
        case PdfAnnotationSubtype.LINE: {
          Object.assign(base, {
            strokeColor: color ?? "#FF0000",
            color: fill ?? "transparent",
            strokeWidth: width ?? 1,
            strokeStyle:
              style === "cloudy"
                ? PdfAnnotationBorderStyle.CLOUDY
                : style === "dash"
                  ? PdfAnnotationBorderStyle.DASHED
                  : PdfAnnotationBorderStyle.SOLID,
            ...(style === "dash" ? { strokeDashArray: numbers(n.dashes) } : {}),
            ...(style === "cloudy" ? { cloudyBorderIntensity: Number(n.intensity ?? 1) } : {}),
          });
          if (type === PdfAnnotationSubtype.LINE) {
            const s = numbers(n.start);
            const e = numbers(n.end);
            Object.assign(base, {
              linePoints: { start: pos(s[0] ?? 0, s[1] ?? 0), end: pos(e[0] ?? 0, e[1] ?? 0) },
            });
          }
          if (type === PdfAnnotationSubtype.POLYGON || type === PdfAnnotationSubtype.POLYLINE)
            Object.assign(base, { vertices: pairs(textOf(n.vertices)) });
          if (type === PdfAnnotationSubtype.LINE || type === PdfAnnotationSubtype.POLYLINE)
            Object.assign(base, { lineEndings: { start: lineEnd(n.head), end: lineEnd(n.tail) } });
          break;
        }
        case PdfAnnotationSubtype.INK: {
          const gestures = ((n.inklist as Attrs | undefined)?.gesture ?? []) as unknown[];
          Object.assign(base, {
            strokeColor: color ?? "#0000FF",
            strokeWidth: width ?? 1,
            inkList: gestures.map((g) => ({ points: pairs(textOf(g)) })),
          });
          break;
        }
        case PdfAnnotationSubtype.STAMP: {
          const icon = PdfAnnotationName[textOf(n.icon) as keyof typeof PdfAnnotationName];
          Object.assign(base, { name: typeof icon === "number" ? icon : PdfAnnotationName.Draft });
          break;
        }
      }
      out.push(base as unknown as PdfAnnotationObject);
    }
  }
  // Parents before their replies, so /IRT resolves when they are created in order.
  const byId = new Map(out.map((a) => [a.id, a]));
  const depth = (a: PdfAnnotationObject | undefined, seen = 0): number =>
    a?.inReplyToId && seen < 20 ? 1 + depth(byId.get(a.inReplyToId), seen + 1) : 0;
  out.sort((a, b) => depth(a) - depth(b));
  return { annotations: out, skipped };
}

// ---- whole documents (worker) ---------------------------------------------------

/** XFDF of every annotation in a PDF. */
export async function documentXfdf(
  engine: import("./pdfium").Engine,
  bytes: Uint8Array,
  fileName: string,
): Promise<string> {
  const doc = await engine
    .openDocumentBuffer({ id: `xfdf-${crypto.randomUUID()}`, content: bytes.slice().buffer })
    .toPromise();
  try {
    const all: PdfAnnotationObject[] = [];
    for (const p of doc.pages) all.push(...(await engine.getPageAnnotations(doc, p).toPromise()));
    return exportXfdf(
      all,
      doc.pages.map((p) => p.size.height),
      fileName,
    );
  } finally {
    await engine.closeDocument(doc).toPromise();
  }
}
