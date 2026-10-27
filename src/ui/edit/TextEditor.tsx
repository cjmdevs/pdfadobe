// Edit PDF (B3): the in-place text editor. A textarea over the box in the closest
// browser font; the box's own text is hidden behind it. Escape, a click elsewhere or a
// shortcut that saves/closes commits: the engine re-typesets the paragraph in the
// worker as one undoable step, and the tab shows the exact PDF result.
import { useEffect, useRef, type CSSProperties } from "react";
import type { EditOutcome, PlainStyle } from "../../engine/edit";
import { pageOp } from "../../app/pages";
import { useWorkbench } from "../../app/workbench";
import { cssFont } from "./cssFont";
import { afterTextEdit, overflowText } from "./editActions";
import {
  editSession,
  newTextStyle,
  reselect,
  useNewTextStyle,
  useSessionStyle,
  type EditSession,
} from "./editStore";

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
  const ref = useRef<HTMLTextAreaElement>(null);
  const initial = session.kind === "box" ? session.box.paragraphs.join("\n") : "";
  const committed = useRef(false);
  // Style picked in the panel while typing; applied when the edit commits.
  const override = useSessionStyle(documentId);
  const newStyle = useNewTextStyle()?.style ?? NEW_TEXT_STYLE;

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const restyled = editSession.style(documentId);
    editSession.registerCommit(documentId, null);
    editSession.close(documentId);
    const text = ref.current?.value ?? initial;
    if ((text === initial && !restyled) || (session.kind === "new" && !text.trim())) return;
    const style: PlainStyle = { ...(newTextStyle.get()?.style ?? NEW_TEXT_STYLE), ...restyled };
    const paragraphs = text.split("\n");
    let outcome: EditOutcome["result"] = null;
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
                  paragraphs.map(() => restyled ?? undefined),
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
          afterTextEdit(wb, documentId, page, r.result);
          return r.bytes;
        },
        { page },
      )
      .then((ok) => {
        const r = outcome as EditOutcome["result"];
        if (!ok) reselect.set(wb.meta[documentId]?.storeId, null);
        if (!ok || !r) return;
        const hit = overflowText(r);
        if (hit)
          wb.toast(
            `The text now runs into ${hit}. Drag the box's right edge to change its width, or undo.`,
          );
      });
  };

  // The latest commit for Escape, the tool closing and clicks on the page.
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });
  useEffect(() => {
    editSession.registerCommit(documentId, () => latest.current());
    // Focus after the click that opened it (its mousedown would take focus back).
    const t = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
    return () => {
      window.clearTimeout(t);
      editSession.registerCommit(documentId, null);
    };
  }, [documentId]);

  // What the text looks like: the box's (or new text's) style with the panel's changes.
  const own = session.kind === "box" ? session.box.styles[0] : undefined;
  const base = own ?? { ...newStyle, fontName: fontNameOf(newStyle.font, "Helvetica") };
  const style = {
    ...base,
    ...override,
    fontName: override?.font ? fontNameOf(override.font, base.fontName) : base.fontName,
  };
  const size = style.size;
  const leading = style.leading;
  const font = cssFont(style.fontName);
  const c = style.color;
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
  const css: CSSProperties & { fieldSizing?: string } = {
    left: rect.l * scale,
    top: (pageHeight - rect.t) * scale,
    minHeight: (rect.t - rect.b) * scale,
    ...(grows
      ? { minWidth: (rect.r - rect.l) * scale, fieldSizing: "content" }
      : { width: (rect.r - rect.l) * scale, fieldSizing: "content" }),
    fontFamily: font.family,
    fontWeight: style?.bold ? 700 : font.weight,
    fontStyle: style?.italic ? "italic" : font.style,
    fontSize: size * scale,
    lineHeight: `${leading * scale}px`,
    textAlign: style?.align === "justify" ? "justify" : (style?.align ?? "left"),
    textDecoration: style?.underline ? "underline" : undefined,
    color: `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a / 255})`,
    whiteSpace: grows ? "pre" : "pre-wrap",
  };

  return (
    <textarea
      ref={ref}
      className="edit-editor"
      data-testid="edit-editor"
      aria-label={session.kind === "box" ? "Edit text" : "New text"}
      defaultValue={initial}
      spellCheck
      style={css}
      onBlur={(e) => {
        // Switching to another program keeps the editor open, like Acrobat, and so does
        // using the Format panel (its changes apply to this text when it commits).
        const to = e.relatedTarget;
        if (to instanceof Element && to.closest("[data-testid=edit-panel]")) return;
        if (document.hasFocus()) commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          commit();
        } else if ((e.ctrlKey || e.metaKey) && /^[swpq]$/i.test(e.key)) {
          // Save / close / print / quit act on the committed text: commit first (the
          // edit is queued before the command, which then runs as usual).
          commit();
        } else {
          // Other keys stay in the editor (no page navigation while typing).
          e.stopPropagation();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

/** A font's name for the browser preview: the file's PostScript name, the standard name. */
function fontNameOf(font: PlainStyle["font"], own: string): string {
  return font.kind === "file"
    ? font.face.postscript || font.face.family
    : font.kind === "standard"
      ? font.name
      : own;
}
