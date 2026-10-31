// Edit PDF (B3): the in-place text editor. A rich-text area over the box in the
// closest browser fonts; the box's own text is hidden behind it. Each paragraph is a
// block, each character run a span, so mixed fonts, sizes, colours, B/I/U and
// superscripts show while typing; the Format panel changes the selection (or, with
// no selection, the whole box), and paragraph formatting (lists, indents, spacing,
// alignment) the paragraphs the selection touches. Escape, a click elsewhere or a
// shortcut that saves/closes commits: the engine re-typesets the box in the worker as
// one undoable step, and the tab shows the exact PDF result.
//
// The DOM is the source of truth while typing; every formatting command reads it back
// into the model (`richModel.ts`), changes the model and draws it again.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { EditOutcome, PlainStyle, RichText } from "../../engine/edit";
import { numberLists } from "../../engine/edit/lists";
import { pageOp } from "../../app/pages";
import { useWorkbench } from "../../app/workbench";
import { fontCss, loadFonts } from "./editorFonts";
import { fontIndex } from "../../app/fontIndex";
import { platform } from "../../platform";
import { afterTextEdit, overflowText, reportTextEdit, textEditOpts } from "./editActions";
import {
  editSession,
  frameSettings,
  newTextStyle,
  reselect,
  useNewTextStyle,
  type EditSession,
  type FormatChange,
} from "./editStore";
import {
  applyChar,
  applyCharAll,
  applyPara,
  fmtAt,
  indent,
  insertText,
  ordered,
  splitAt,
  toEngine,
  type CharFmt,
  type Pos,
  type RichPara,
} from "./richModel";

/** New text from Add Text until the panel picks another style (every reader has Helvetica). */
export const NEW_TEXT_STYLE: PlainStyle = {
  font: { kind: "standard", name: "Helvetica" },
  size: 11,
  color: { r: 0, g: 0, b: 0, a: 255 },
  bold: false,
  italic: false,
  underline: false,
  align: "left",
  leading: 13.2,
};

/** Baseline below the top of the first line (roughly the ascent). */
const ASCENT = 0.8;
const SCRIPT = 0.6;

/** The box's paragraphs as the editor's model (list markers are drawn, not typed). */
function modelOf(session: EditSession, fresh: PlainStyle): RichPara[] {
  if (session.kind === "new") {
    const { align, leading, font, size, color, bold, italic, underline } = fresh;
    return [
      {
        text: "",
        base: {
          font,
          fontName: fontNameOf(font, "Helvetica"),
          size,
          color,
          bold,
          italic,
          underline,
        },
        runs: [],
        para: { align, leading },
      },
    ];
  }
  const b = session.box;
  return b.paragraphs.map((full, i) => {
    const st = b.styles[Math.min(i, b.styles.length - 1)];
    const mk = st?.marker;
    const cut =
      mk && full.startsWith(mk.text) ? mk.text.length + (full[mk.text.length] === " " ? 1 : 0) : 0;
    const runs = (b.runs[i] ?? [])
      .map((r) => ({
        start: Math.max(0, r.start - cut),
        end: r.end - cut,
        fmt: {
          font: { kind: "original" as const, name: r.fontName },
          fontName: r.fontName,
          size: r.size,
          color: r.color,
          bold: r.bold,
          italic: r.italic,
          ...(r.script ? { script: r.script } : {}),
        },
      }))
      .filter((r) => r.end > r.start);
    return {
      text: full.slice(cut),
      base: {
        font: { kind: "original" as const, name: st?.fontName ?? "" },
        fontName: st?.fontName ?? "",
        size: st?.size ?? 11,
        color: st?.color ?? { r: 0, g: 0, b: 0, a: 255 },
        bold: st?.bold ?? false,
        italic: st?.italic ?? false,
        underline: st?.underline ?? false,
      },
      runs,
      para: {
        align: st?.align ?? "left",
        leading: st?.leading ?? 13,
        ...(st?.indent ? { indent: st.indent } : {}),
        ...(st?.spaceBefore ? { spaceBefore: st.spaceBefore } : {}),
        ...(st?.list ? { list: st.list } : {}),
        ...(mk ? { markerAt: mk.at } : {}),
      },
    };
  });
}

const css = (s: Record<string, string | number | undefined>) =>
  Object.entries(s)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v}`)
    .join(";");

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A run's format for its span's data-f. A font from a file carries its bytes, which
 * stay in `fonts` (by key); the span keeps only the key.
 */
function encodeFmt(f: CharFmt, fonts: Map<string, CharFmt["font"]>): string {
  if (f.font?.kind !== "file") return JSON.stringify(f);
  const key = `${f.font.face.path}#${f.font.face.index}`;
  fonts.set(key, f.font);
  return JSON.stringify({ ...f, font: { ref: key } });
}

function decodeFmt(json: string, fonts: Map<string, CharFmt["font"]>): CharFmt {
  try {
    const f = JSON.parse(json) as CharFmt & { font?: { ref?: string } };
    const ref = (f.font as { ref?: string } | undefined)?.ref;
    if (ref === undefined) return f;
    const font = fonts.get(ref);
    const { font: _f, ...rest } = f;
    void _f;
    return font ? { ...rest, font } : rest;
  } catch {
    return {};
  }
}

/** Draws the model into the editable element (one block per paragraph, spans per run). */
function draw(
  el: HTMLElement,
  doc: RichPara[],
  scale: number,
  fonts: Map<string, CharFmt["font"]>,
) {
  const markers = numberLists(doc.map((p) => p.para.list ?? null));
  el.innerHTML = doc
    .map((p, i) => {
      const ind = p.para.indent ?? { first: 0, left: 0 };
      const marker = markers[i];
      // The marker sits where the page has it (`at` from the box's left), the text at the indent.
      const at = p.para.markerAt;
      const hang = !marker
        ? 0
        : at !== undefined && ind.left > at
          ? ind.left - at
          : Math.max(ind.left - ind.first, 0) || 18;
      const block = css({
        textAlign: p.para.align === "justify" ? "justify" : p.para.align,
        lineHeight: p.para.leading ? `${p.para.leading * scale}px` : undefined,
        paddingLeft: `${(marker ? ind.left : Math.min(ind.first, ind.left)) * scale}px`,
        paddingRight: ind.right ? `${ind.right * scale}px` : undefined,
        textIndent: marker ? "0" : `${(ind.first - Math.min(ind.first, ind.left)) * scale}px`,
        marginTop: i && p.para.spaceBefore ? `${p.para.spaceBefore * scale}px` : undefined,
        marginBottom: p.para.spaceAfter ? `${p.para.spaceAfter * scale}px` : undefined,
        "--hang": `${hang * scale}px`,
      });
      // Cut points: every run edge.
      const cuts = [...new Set([0, p.text.length, ...p.runs.flatMap((r) => [r.start, r.end])])]
        .filter((c) => c >= 0 && c <= p.text.length)
        .sort((a, b) => a - b);
      const spans: string[] = [];
      for (let k = 0; k + 1 < cuts.length; k++) {
        const a = cuts[k] ?? 0;
        const b = cuts[k + 1] ?? 0;
        const fmt = p.runs
          .filter((r) => r.start <= a && r.end >= b)
          .reduce<CharFmt>((f, r) => ({ ...f, ...r.fmt }), {});
        spans.push(
          `<span data-f="${esc(encodeFmt(fmt, fonts))}" style="${esc(spanCss({ ...p.base, ...fmt }, scale))}">${esc(p.text.slice(a, b))}</span>`,
        );
      }
      return `<div class="rp" data-i="${i}"${marker ? ` data-marker="${esc(marker)}"` : ""} style="${esc(block)}">${spans.join("") || "<br>"}</div>`;
    })
    .join("");
}

/**
 * How far to move the editor down (screen pixels) so its first baseline is at `want`
 * below its top edge, where the page draws it: CSS puts a baseline by the font's own
 * ascent and the line height, which is not where the PDF has it.
 */
function baselineShift(el: HTMLElement, want: number): number {
  const first = el.querySelector(".rp");
  if (!first) return 0;
  const probe = document.createElement("span");
  probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  first.insertBefore(probe, first.firstChild);
  const got = probe.getBoundingClientRect().bottom - el.getBoundingClientRect().top;
  probe.remove();
  return want - got;
}

function spanCss(f: CharFmt, scale: number): string {
  // The real font where it could be loaded (`editorFonts.ts`), else a look-alike.
  const font = fontCss(f.fontName ?? "Helvetica", f.font, !!f.bold, !!f.italic);
  const size = (f.size ?? 11) * (f.script ? SCRIPT : 1);
  return css({
    fontFamily: font.family,
    fontWeight: font.weight,
    fontStyle: font.style,
    fontSize: `${size * scale}px`,
    color: f.color ? `rgba(${f.color.r},${f.color.g},${f.color.b},${f.color.a / 255})` : undefined,
    textDecoration: f.underline ? "underline" : undefined,
    verticalAlign: f.script === "super" ? "super" : f.script === "sub" ? "sub" : undefined,
    letterSpacing: f.charSpacing ? `${(f.charSpacing / 1000) * size * scale}px` : undefined,
    wordSpacing: f.wordSpacing ? `${(f.wordSpacing / 1000) * size * scale}px` : undefined,
  });
}

/** Reads the editable element back into the model (`prev` holds the paragraph formats). */
function read(el: HTMLElement, prev: RichPara[], fonts: Map<string, CharFmt["font"]>): RichPara[] {
  const blocks = [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
  const out: RichPara[] = [];
  for (const b of blocks) {
    const src = prev[Number(b.dataset.i ?? out.length)] ?? prev.at(-1) ?? prev[0];
    if (!src) continue;
    let text = "";
    const fmts: CharFmt[] = [];
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      // Non-breaking spaces (the browser types them at line ends) are spaces.
      const t = (n.textContent ?? "").replace(/\u00a0/g, " ");
      const fmt = fmtOf(n.parentElement?.closest<HTMLElement>("[data-f]"), fonts);
      text += t;
      for (let k = 0; k < t.length; k++) fmts.push(fmt);
    }
    const runs = fmts
      .map((fmt, i) => ({ start: i, end: i + 1, fmt }))
      .filter((r) => Object.keys(r.fmt).length)
      .reduce<RichPara["runs"]>((acc, r) => {
        const last = acc.at(-1);
        if (last && last.end === r.start && JSON.stringify(last.fmt) === JSON.stringify(r.fmt))
          last.end = r.end;
        else acc.push({ ...r });
        return acc;
      }, []);
    out.push({ ...src, text, runs });
  }
  return out.length ? out : prev.slice(0, 1).map((p) => ({ ...p, text: "", runs: [] }));
}

/** A span's character format (its data-f JSON), or none. */
function fmtOf(
  holder: HTMLElement | null | undefined,
  fonts: Map<string, CharFmt["font"]>,
): CharFmt {
  return holder?.dataset.f ? decodeFmt(holder.dataset.f, fonts) : {};
}

/** The DOM position (node, offset) of a model position, or of its paragraph's end. */
function domAt(el: HTMLElement, pos: Pos): [Node, number] {
  const block = el.children[pos.p] ?? el.lastElementChild ?? el;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let left = pos.o;
  let last: Node | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent?.length ?? 0;
    if (left <= len) return [n, left];
    left -= len;
    last = n;
  }
  return last ? [last, last.textContent?.length ?? 0] : [block, 0];
}

/** A DOM position as a model position. */
function posOf(el: HTMLElement, node: Node, offset: number): Pos {
  const blocks = [...el.children];
  const p = blocks.findIndex((b) => b === node || b.contains(node));
  if (p < 0) return { p: Math.max(0, blocks.length - 1), o: 0 };
  const block = blocks[p] as HTMLElement;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let o = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === node) return { p, o: o + offset };
    o += n.textContent?.length ?? 0;
  }
  // The node is an element: count the text before its offset-th child.
  if (node instanceof Element && node !== block) return { p, o };
  return { p, o: node === block ? Math.min(o, offset ? o : 0) : o };
}

export function TextEditor({
  documentId,
  session,
  pageHeight,
  scale,
}: {
  documentId: string;
  session: EditSession;
  pageHeight: number;
  scale: number;
}) {
  const wb = useWorkbench();
  const ref = useRef<HTMLDivElement>(null);
  const newStyle = useNewTextStyle()?.style ?? NEW_TEXT_STYLE;
  const [initial] = useState<RichPara[]>(() => modelOf(session, newStyle));
  const model = useRef<RichPara[]>(initial);
  const committed = useRef(false);
  /** The last selection inside the editor: the panel's fields take focus (and the browser's selection) away. */
  const lastSel = useRef<[Pos, Pos] | null>(null);
  /** Fonts from files used in the text (their bytes never go into the DOM). */
  const fonts = useRef(new Map<string, CharFmt["font"]>());
  /** Screen pixels the editor moves down to put its first baseline on the page's. */
  const [lift, setLift] = useState(0);
  const settle = () => {
    const el = ref.current;
    if (!el || session.kind !== "box") return;
    // The top border is 1px.
    const want = (session.box.rect.t - session.box.baseline) * scale + 1;
    setLift(Math.round(baselineShift(el, want) * 10) / 10);
  };

  /** The model as the DOM has it now. */
  const now = () => {
    const el = ref.current;
    if (el) model.current = read(el, model.current, fonts.current);
    return model.current;
  };
  const selection = (): [Pos, Pos] | null => {
    const el = ref.current;
    const s = window.getSelection();
    if (!el || !s || !s.anchorNode || !s.focusNode || !el.contains(s.anchorNode)) return null;
    return [posOf(el, s.anchorNode, s.anchorOffset), posOf(el, s.focusNode, s.focusOffset)];
  };
  const redraw = (doc: RichPara[], sel: [Pos, Pos] | null) => {
    const el = ref.current;
    model.current = doc;
    if (!el) return;
    // Setting the browser's selection in an editable element focuses it: only when it
    // has focus already (a panel field keeps its own; the selection is remembered).
    const focused = document.activeElement === el;
    draw(el, doc, scale, fonts.current);
    settle();
    if (sel) lastSel.current = sel;
    if (!sel || !focused) return;
    const [a, b] = sel;
    const range = document.createRange();
    const s = window.getSelection();
    const [an, ao] = domAt(el, a);
    const [bn, bo] = domAt(el, b);
    range.setStart(an, ao);
    s?.removeAllRanges();
    s?.addRange(range);
    s?.extend(bn, bo);
  };
  /** Tells the panel the format at the caret. */
  const report = () => {
    const live = document.activeElement === ref.current ? selection() : null;
    if (live) lastSel.current = live;
    const sel = live ?? lastSel.current;
    const doc = model.current;
    const at = sel ? ordered(sel[0], sel[1])[0] : { p: 0, o: 0 };
    const p = doc[at.p];
    editSession.setCaret(documentId, { char: fmtAt(doc, at), para: p?.para ?? {} });
  };

  /** Loads the real fonts the text uses; draws again once any arrive. */
  const ensureFonts = () => {
    const wanted = model.current.flatMap((p) =>
      [p.base, ...p.runs.map((r) => ({ ...p.base, ...r.fmt }))].map((f) => ({
        fontName: f.fontName ?? "Helvetica",
        font: f.font,
      })),
    );
    void fontIndex(platform, wb.settings.firmFontsPath)
      .catch(() => null)
      .then((index) => loadFonts(wanted, index))
      .then((loaded) => {
        if (loaded && !committed.current) redraw(now(), selection());
      });
  };

  /** A change from the Format panel. */
  const format = (change: FormatChange) => {
    // The panel has focus: the browser's selection is not the user's any more.
    const focused = document.activeElement === ref.current;
    const sel = (focused ? selection() : null) ?? lastSel.current ?? selection();
    let doc = now();
    const [from, to] = sel
      ? ordered(sel[0], sel[1])
      : [
          { p: 0, o: 0 },
          { p: doc.length - 1, o: 0 },
        ];
    const collapsed = !sel || (from.p === to.p && from.o === to.o);
    if (change.char)
      doc = collapsed ? applyCharAll(doc, change.char) : applyChar(doc, from, to, change.char);
    // Paragraph formatting: the paragraphs the selection touches (all without one).
    const p0 = sel ? from.p : 0;
    const p1 = sel ? to.p : doc.length - 1;
    if (change.para) doc = applyPara(doc, p0, p1, change.para);
    if (change.indent) doc = indent(doc, p0, p1, change.indent);
    redraw(doc, sel);
    if (sel) lastSel.current = sel;
    report();
    if (change.char?.font) ensureFonts();
  };

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    editSession.registerCommit(documentId, null);
    editSession.close(documentId);
    const doc = now();
    const same = JSON.stringify(doc) === JSON.stringify(initial);
    if (same || (session.kind === "new" && !doc.some((p) => p.text.trim()))) return;
    const paragraphs: RichText[] = toEngine(doc);
    const style: PlainStyle = {
      ...(newTextStyle.get()?.style ?? NEW_TEXT_STYLE),
      ...(doc[0] ? toEngine([doc[0]])[0]?.style : {}),
    };
    let outcome: EditOutcome["result"] = null;
    // The box keeps its frame settings through the edit.
    const frame =
      session.kind === "box"
        ? frameSettings.get(wb.meta[documentId]?.storeId, session.page, session.box)
        : undefined;
    const page = session.page;
    void wb
      .edit(
        documentId,
        session.kind === "box" ? "Edit text" : "Add text",
        async (bytes) => {
          const r =
            session.kind === "box"
              ? await pageOp(
                  "editText",
                  bytes,
                  { page, id: session.box.id, preview: session.box.preview },
                  paragraphs,
                  [],
                  undefined,
                  textEditOpts(),
                )
              : await pageOp(
                  "addText",
                  bytes,
                  page,
                  {
                    x: session.x,
                    y: session.top - style.size * ASCENT,
                    width: session.width,
                  },
                  paragraphs,
                  style,
                );
          outcome = r.result;
          // Select the edited box again once the tab reloads (set before it does).
          afterTextEdit(wb, documentId, page, r.result, frame);
          return r.bytes;
        },
        { page },
      )
      .then((ok) => {
        const r = outcome as EditOutcome["result"];
        if (!ok) reselect.set(wb.meta[documentId]?.storeId, null);
        if (!ok || !r) return;
        reportTextEdit(wb, r, overflowText(r));
      });
  };

  /** Split at the caret: the text before stays in this box, the rest starts a new one. */
  const split = () => {
    if (committed.current || session.kind !== "box") return;
    const sel = selection();
    if (!sel) return;
    committed.current = true;
    editSession.registerCommit(documentId, null);
    editSession.close(documentId);
    const doc = now();
    const at = ordered(sel[0], sel[1])[0];
    const page = session.page;
    void wb.edit(
      documentId,
      "Split text box",
      async (bytes) => {
        const r = await pageOp(
          "splitText",
          bytes,
          { page, id: session.box.id, preview: session.box.preview },
          toEngine(doc),
          { paragraph: at.p, offset: at.o },
        );
        afterTextEdit(wb, documentId, page, r.result);
        return r.bytes;
      },
      { page },
    );
  };

  // The latest commit for Escape, the tool closing and clicks on the page.
  const latest = useRef({ commit, split, format, report, ensureFonts, settle });
  useEffect(() => {
    latest.current = { commit, split, format, report, ensureFonts, settle };
  });
  useEffect(() => {
    const el = ref.current;
    if (el) draw(el, model.current, scale, fonts.current);
    latest.current.settle();
    latest.current.ensureFonts();
    editSession.registerCommit(documentId, () => latest.current.commit());
    editSession.registerSplit(documentId, () => latest.current.split());
    editSession.registerFormatter(documentId, (c) => latest.current.format(c));
    const onSel = () => latest.current.report();
    document.addEventListener("selectionchange", onSel);
    // Focus after the click that opened it (its mousedown would take focus back), with
    // the caret at the end.
    const t = window.setTimeout(() => {
      const e = ref.current;
      if (!e) return;
      e.focus();
      const s = window.getSelection();
      // The caret where the click was (one click edits right there), else at the end.
      const at = session.kind === "box" ? session.at : undefined;
      const hit = at ? caretAt(at.x, at.y) : null;
      if (hit && e.contains(hit.node)) s?.collapse(hit.node, hit.offset);
      else {
        const last = model.current.length - 1;
        const end = { p: last, o: model.current[last]?.text.length ?? 0 };
        const [n, o] = domAt(e, end);
        s?.collapse(n, o);
      }
      latest.current.report();
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("selectionchange", onSel);
      editSession.registerCommit(documentId, null);
      editSession.registerSplit(documentId, null);
      editSession.registerFormatter(documentId, null);
      editSession.setCaret(documentId, null);
    };
    // Drawn once: later redraws come from formatting commands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // The frame comes from where the box was (the text itself is drawn by `draw`).
  const first = initial[0];
  const size = first?.base.size ?? 11;
  const leading = first?.para.leading ?? size * 1.2;
  const rect =
    session.kind === "box"
      ? session.box.rect
      : {
          l: session.x,
          r: session.x + (session.width ?? size * 4),
          t: session.top,
          b: session.top - leading,
        };
  const grows = session.kind === "box" ? session.box.grows : session.width === null;
  const box: CSSProperties = {
    // The text starts at the frame's edge (inside the 1px border and padding).
    left: rect.l * scale - 2,
    top: (pageHeight - rect.t) * scale + lift,
    minHeight: (rect.t - rect.b) * scale,
    ...(grows ? { minWidth: (rect.r - rect.l) * scale } : { width: (rect.r - rect.l) * scale }),
    whiteSpace: grows ? "pre" : "pre-wrap",
  };

  /** Ctrl+B / I / U toggle the format at the selection (the browser's own would add tags). */
  const toggle = (key: "bold" | "italic" | "underline") => {
    const sel = selection();
    const at = sel ? ordered(sel[0], sel[1])[0] : { p: 0, o: 0 };
    const cur = fmtAt(now(), { p: at.p, o: at.o + 1 });
    latest.current.format({ char: { [key]: !cur[key] } });
  };

  return (
    <div
      ref={ref}
      className="edit-editor rich"
      data-testid="edit-editor"
      role="textbox"
      aria-multiline="true"
      aria-label={session.kind === "box" ? "Edit text" : "New text"}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      style={box}
      onBlur={(e) => {
        // Switching to another program keeps the editor open, like Acrobat, and so does
        // using the Format panel (its changes apply to this text).
        const to = e.relatedTarget;
        if (to instanceof Element && to.closest("[data-testid=edit-panel]")) return;
        if (document.hasFocus()) commit();
      }}
      onKeyDown={(e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          commit();
        } else if (mod && /^[swpq]$/i.test(e.key)) {
          // Save / close / print / quit act on the committed text: commit first (the
          // edit is queued before the command, which then runs as usual).
          commit();
        } else if (mod && /^[biu]$/i.test(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          toggle(({ b: "bold", i: "italic", u: "underline" } as const)[e.key.toLowerCase() as "b"]);
        } else if (e.key === "Enter") {
          // A new paragraph in the model (the browser's own would copy blocks and spans).
          e.preventDefault();
          e.stopPropagation();
          const sel = selection();
          if (!sel) return;
          const [a, b] = ordered(sel[0], sel[1]);
          let doc = now();
          if (a.p !== b.p || a.o !== b.o) doc = removeRange(doc, a, b);
          doc = splitAt(doc, a);
          const at = { p: a.p + 1, o: 0 };
          redraw(doc, [at, at]);
        } else {
          // Other keys stay in the editor (no page navigation while typing).
          e.stopPropagation();
        }
      }}
      onPaste={(e) => {
        // Plain text only, in the format where it lands.
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        const sel = selection();
        if (!sel || !text) return;
        const [a, b] = ordered(sel[0], sel[1]);
        let doc = now();
        if (a.p !== b.p || a.o !== b.o) doc = removeRange(doc, a, b);
        const r = insertText(doc, a, text);
        redraw(r.doc, [r.at, r.at]);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

/** The text position under a screen point (Chromium / WebView2's caretRangeFromPoint). */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretRangeFromPoint?(x: number, y: number): Range | null;
  };
  const r = d.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

/** Deletes the text between `a` and `b` (a <= b), joining the paragraphs it spans. */
function removeRange(doc: RichPara[], a: Pos, b: Pos): RichPara[] {
  const first = doc[a.p];
  const last = doc[b.p];
  if (!first || !last) return doc;
  const keep = (p: RichPara, s: number, e: number, shift: number) =>
    p.runs
      .map((r) => ({ ...r, start: Math.max(r.start, s), end: Math.min(r.end, e) }))
      .filter((r) => r.end > r.start)
      .map((r) => ({ ...r, start: r.start + shift, end: r.end + shift }));
  const joined: RichPara = {
    ...first,
    text: first.text.slice(0, a.o) + last.text.slice(b.o),
    runs: [...keep(first, 0, a.o, 0), ...keep(last, b.o, last.text.length, a.o - b.o)],
  };
  return [...doc.slice(0, a.p), joined, ...doc.slice(b.p + 1)];
}

/** A font's name for the browser preview: the file's PostScript name, the standard name. */
export function fontNameOf(font: PlainStyle["font"], own: string): string {
  return font.kind === "file"
    ? font.face.postscript || font.face.family
    : font.kind === "standard"
      ? font.name
      : own;
}
