// Edit PDF (B3): the in-place text editor. A textarea over the box in the closest
// browser font; the box's own text is hidden behind it. Escape, a click elsewhere or a
// shortcut that saves/closes commits: the engine re-typesets the paragraph in the
// worker as one undoable step, and the tab shows the exact PDF result.
import { useEffect, useRef, type CSSProperties } from "react";
import type { EditOutcome, PlainStyle } from "../../engine/edit";
import { pageOp } from "../../app/pages";
import { useWorkbench } from "../../app/workbench";
import { cssFont } from "./cssFont";
import { editSession, reselect, type EditSession } from "./editStore";

/** New text from Add Text, until the properties panel (step U3) offers other fonts. */
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

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    editSession.registerCommit(documentId, null);
    editSession.close(documentId);
    const text = ref.current?.value ?? initial;
    if (text === initial || (session.kind === "new" && !text.trim())) return;
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
                )
              : await pageOp(
                  "addText",
                  bytes,
                  page,
                  {
                    x: session.x,
                    y: session.top - NEW_TEXT_STYLE.size * ASCENT,
                    width: session.width,
                  },
                  paragraphs,
                  NEW_TEXT_STYLE,
                );
          outcome = r.result;
          // Select the edited box again once the tab reloads (set before it does).
          const first = r.result?.lines[0];
          if (first)
            reselect.set(wb.meta[documentId]?.storeId, {
              page,
              x: (first.l + first.r) / 2,
              y: (first.b + first.t) / 2,
            });
          return r.bytes;
        },
        { page },
      )
      .then((ok) => {
        const r = outcome as EditOutcome["result"];
        if (!ok) reselect.set(wb.meta[documentId]?.storeId, null);
        if (!ok || !r) return;
        if (r.overflow.length) {
          const hit = r.overflow.find((o) => o.kind === "text");
          wb.toast(
            hit
              ? `The text now runs into "${hit.text}". Shorten it, or make the box wider.`
              : "The text now runs across a line on the page. Shorten it, or make the box wider.",
          );
        }
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

  const style = session.kind === "box" ? session.box.styles[0] : undefined;
  const size = style?.size ?? NEW_TEXT_STYLE.size;
  const leading = style?.leading ?? NEW_TEXT_STYLE.leading;
  const font = cssFont(style?.fontName ?? "Helvetica");
  const c = style?.color ?? NEW_TEXT_STYLE.color;
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
      onBlur={() => {
        // Switching to another program keeps the editor open, like Acrobat.
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
