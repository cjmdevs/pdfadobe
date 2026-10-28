// Edit PDF (B3): the tool's panel in the Tools pane, like Acrobat's Format panel.
// Font (in this document / standard / firm / Windows), size, colour, bold, italic,
// underline, alignment and line spacing, with warnings for missing letters,
// substitution and embedding restrictions.
//
// What a change applies to:
//   - the open editor: shown at once, written when the edit commits
//   - Add Text (armed): the style for new text
//   - a selected text box: re-typeset now, one undo step
// One style per paragraph (stage 1): a change sets that property for every paragraph
// of the box and keeps the others as they are.
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditTextBox, PlainParagraphStyle, PlainStyle, Rgba } from "../../engine/edit";
import { parsePdfFontName } from "../../engine/edit/fonts";
import { pageOp } from "../../app/pages";
import { useWorkbench } from "../../app/workbench";
import { fontIndex, type FontIndex } from "../../app/fontIndex";
import { platform } from "../../platform";
import { fontOptions, resolveFont, type Section, type Warning } from "./fontChoices";
import {
  boundingBoxes,
  editSession,
  newTextStyle,
  useAddingText,
  useEditSelection,
  useEditSession,
  useNewTextStyle,
  usePageInfo,
  useOverflowNote,
  usePendingImage,
  useSessionFontKey,
  useSessionStyle,
  useShowBoxes,
} from "./editStore";
import { NEW_TEXT_STYLE } from "./TextEditor";
import {
  afterTextEdit,
  deleteSelection,
  joinSelection,
  placeImageEdit,
  replaceImageEdit,
} from "./editActions";

const SECTION_LABEL: Record<Section, string> = {
  document: "In this document",
  standard: "Standard PDF fonts (not embedded)",
  firm: "Firm",
  windows: "Windows",
};

const ALIGNS = [
  ["left", "Align left", "L"],
  ["center", "Center", "C"],
  ["right", "Align right", "R"],
  ["justify", "Justify", "J"],
] as const;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const keyForPdfFont = (name: string) => `document:${squash(parsePdfFontName(name).family)}`;
const hex = (c: Rgba) =>
  `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const fromHex = (h: string): Rgba => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
  a: 255,
});

type Target =
  | { kind: "editor"; box: EditTextBox | null; page: number }
  | { kind: "new" }
  | { kind: "box"; box: EditTextBox; page: number };

/** The style the panel shows: the target's, with the font as a picker key. */
interface Format extends Omit<PlainParagraphStyle, "fontName"> {
  fontKey: string;
}

export default function EditPanel({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const sel = useEditSelection(documentId);
  const session = useEditSession(documentId);
  const adding = useAddingText(documentId);
  const placing = usePendingImage(documentId);
  const overflow = useOverflowNote(documentId);
  const sessionStyle = useSessionStyle(documentId);
  const sessionFontKey = useSessionFontKey(documentId);
  const newText = useNewTextStyle();
  const info = usePageInfo(documentId, session?.page ?? sel?.page ?? null);
  const [fonts, setFonts] = useState<FontIndex | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [working, setWorking] = useState(false);

  const firm = wb.settings.firmFontsPath;
  useEffect(() => {
    let live = true;
    fontIndex(platform, firm).then(
      (f) => live && setFonts(f),
      () => live && setFonts(null),
    );
    return () => {
      live = false;
    };
  }, [firm]);

  const selectedBox = sel?.kind === "text" ? info?.boxes[sel.id] : undefined;
  const target: Target | null = session
    ? { kind: "editor", box: session.kind === "box" ? session.box : null, page: session.page }
    : adding
      ? { kind: "new" }
      : selectedBox && sel
        ? { kind: "box", box: selectedBox, page: sel.page }
        : null;
  const box = target && target.kind !== "new" ? target.box : null;
  const own: PlainParagraphStyle | undefined = box?.styles[0];

  // Old warnings go when the target changes.
  const targetKey = target ? `${target.kind}:${box?.id ?? "new"}:${box?.preview ?? ""}` : "";
  const [shownFor, setShownFor] = useState(targetKey);
  if (shownFor !== targetKey) {
    setShownFor(targetKey);
    setWarnings([]);
  }

  const options = useMemo(
    () =>
      fontOptions(
        (info?.boxes ?? []).flatMap((b) => b.styles.map((s) => s.fontName)),
        fonts?.faces ?? [],
      ),
    [info, fonts],
  );

  // Several text boxes picked with Ctrl+click: they can be joined.
  if (!session && sel?.kind === "text" && sel.more?.length) {
    return (
      <section className="tool-panel" aria-label="Edit PDF" data-testid="edit-panel">
        <h3 className="tool-panel-title">Edit PDF</h3>
        <p data-testid="edit-selection">
          {sel.more.length + 1} text boxes selected on page {sel.page + 1}. Ctrl+click a box to add
          or remove it.
        </p>
        <div className="format-row">
          <button
            type="button"
            data-testid="edit-join"
            disabled={wb.busy !== null}
            onClick={() => void joinSelection(wb, documentId, sel)}
          >
            Join into one paragraph
          </button>
        </div>
        <BoxesToggle />
      </section>
    );
  }

  if (!target) {
    const image = sel?.kind === "image" ? info?.images[sel.id] : undefined;
    return (
      <section className="tool-panel" aria-label="Edit PDF" data-testid="edit-panel">
        <h3 className="tool-panel-title">Edit PDF</h3>
        {placing ? (
          <p data-testid="edit-target">
            Click on the page to place {placing.name}, or drag to set its width. Esc cancels.
          </p>
        ) : sel?.kind === "image" && image ? (
          <>
            <p data-testid="edit-selection">
              Image on page {sel.page + 1}: drag to move, corners to resize (Shift: free), the round
              handle to rotate (Shift: 15° steps).
            </p>
            <div className="format-row">
              <button
                type="button"
                disabled={wb.busy !== null}
                onClick={() => void replaceImageEdit(wb, documentId, sel.page, image)}
              >
                Replace image…
              </button>
              <button
                type="button"
                disabled={wb.busy !== null}
                onClick={() => void deleteSelection(wb, documentId, sel)}
              >
                Delete image
              </button>
            </div>
            <div className="format-row" role="group" aria-label="Rotate image">
              {(
                [
                  [90, "Rotate left"],
                  [-90, "Rotate right"],
                ] as const
              ).map(([turn, label]) => (
                <button
                  key={label}
                  type="button"
                  disabled={wb.busy !== null}
                  onClick={() =>
                    void placeImageEdit(
                      wb,
                      documentId,
                      sel.page,
                      image,
                      { ...image.placement, rotation: image.placement.rotation + turn },
                      "Rotate image",
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">
            Click text to edit it (Esc or a click elsewhere finishes), or click an image to select
            it. Ctrl+click text boxes to select several and join them.
          </p>
        )}
        <BoxesToggle />
      </section>
    );
  }

  const newBase = newText?.style ?? NEW_TEXT_STYLE;
  const base: Format = own
    ? { ...own, fontKey: keyForPdfFont(own.fontName) }
    : {
        ...newBase,
        fontKey:
          newText?.fontKey ??
          `standard:${squash(newBase.font.kind === "standard" ? newBase.font.name : "helvetica")}`,
      };
  const format: Format =
    target.kind === "editor"
      ? { ...base, ...sessionStyle, fontKey: sessionFontKey ?? base.fontKey }
      : base;
  const text = box ? box.paragraphs.join(" ") : "";

  async function apply(change: Partial<Format>) {
    if (!target) return;
    const next = { ...format, ...change };
    const override: Partial<PlainStyle> = {};
    for (const k of ["size", "color", "bold", "italic", "underline", "align", "leading"] as const)
      if (k in change) Object.assign(override, { [k]: next[k] });
    if ("fontKey" in change || "bold" in change || "italic" in change) {
      const option = options.find((o) => o.key === next.fontKey);
      if (!option || !fonts) return;
      const r = await resolveFont({
        option,
        bold: next.bold,
        italic: next.italic,
        text,
        ownFont: own?.fontName ?? null,
        faces: fonts.faces,
        metrics: fonts.metrics,
        bytes: fonts.bytes,
      });
      setWarnings(r.warnings);
      if (!r.font || r.warnings.some((w) => w.level === "error")) return;
      override.font = r.font;
    } else setWarnings([]);

    if (target.kind === "editor") {
      editSession.setStyle(documentId, override, "fontKey" in change ? next.fontKey : null);
      return;
    }
    if (target.kind === "new") {
      newTextStyle.set({ style: { ...newBase, ...override }, fontKey: next.fontKey });
      return;
    }
    const b = target.box;
    const page = target.page;
    setWorking(true);
    let hit: string | null = null;
    await wb.edit(
      documentId,
      "Change text style",
      async (bytes) => {
        const r = await pageOp(
          "editText",
          bytes,
          { page, id: b.id, preview: b.preview },
          b.paragraphs,
          b.paragraphs.map(() => override),
        );
        hit = afterTextEdit(wb, documentId, page, r.result);
        return r.bytes;
      },
      { page },
    );
    setWorking(false);
    if (hit)
      wb.toast(
        `The text now runs into ${hit as string}. Drag the box's right edge to change its width, or undo.`,
      );
  }

  const disabled = working || wb.busy !== null;
  const known = options.some((o) => o.key === format.fontKey);
  const sections = (["document", "standard", "firm", "windows"] as const).filter((s) =>
    options.some((o) => o.section === s),
  );
  const toggle = (name: string, prop: "bold" | "italic" | "underline", label: string) => (
    <button
      type="button"
      className={`format-toggle${format[prop] ? " pressed" : ""}`}
      aria-label={label}
      aria-pressed={format[prop]}
      title={label}
      disabled={disabled}
      onClick={() => void apply({ [prop]: !format[prop] })}
    >
      {name}
    </button>
  );

  return (
    <section className="tool-panel edit-format" aria-label="Edit PDF" data-testid="edit-panel">
      <h3 className="tool-panel-title">Format</h3>
      <p className="small muted" data-testid="edit-target">
        {target.kind === "new"
          ? "New text: click on the page to place it, drag to set its width. Esc cancels."
          : target.kind === "editor"
            ? "Editing: changes apply when you finish (Esc or a click elsewhere)."
            : "Changes apply now (Ctrl+Z undoes)."}
      </p>
      {target.kind !== "new" && (
        <p className="small" data-testid="edit-selection">
          Text box on page {target.page + 1}: {box?.preview ?? "new text"}
        </p>
      )}

      <label className="format-row">
        <span>Font</span>
        <select
          aria-label="Font"
          value={format.fontKey}
          disabled={disabled || !fonts}
          onChange={(e) => void apply({ fontKey: e.target.value })}
        >
          {!known && <option value={format.fontKey}>{format.fontKey.split(":")[1]}</option>}
          {sections.map((s) => (
            <optgroup key={s} label={SECTION_LABEL[s]}>
              {options
                .filter((o) => o.section === s)
                .map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {!fonts && <p className="small muted">Reading fonts…</p>}
      {fonts?.firm === "offline" && (
        <p className="small muted">The firm font folder is offline: using its local copy.</p>
      )}

      <div className="format-row">
        <label>
          <span>Size</span>
          <NumberField
            label="Font size"
            value={format.size}
            min={4}
            max={144}
            step={0.5}
            disabled={disabled}
            onCommit={(size) => void apply({ size })}
          />
        </label>
        <label>
          <span>Colour</span>
          <ColorField
            value={hex(format.color)}
            disabled={disabled}
            onCommit={(h) => void apply({ color: fromHex(h) })}
          />
        </label>
      </div>

      <div className="format-row" role="group" aria-label="Style">
        {toggle("B", "bold", "Bold")}
        {toggle("I", "italic", "Italic")}
        {toggle("U", "underline", "Underline")}
      </div>

      <div className="format-row" role="group" aria-label="Alignment">
        {ALIGNS.map(([value, label, letter]) => (
          <button
            key={value}
            type="button"
            className={`format-toggle${format.align === value ? " pressed" : ""}`}
            aria-label={label}
            aria-pressed={format.align === value}
            title={label}
            disabled={disabled}
            onClick={() => void apply({ align: value })}
          >
            {letter}
          </button>
        ))}
      </div>

      <label className="format-row">
        <span>Line spacing (pt)</span>
        <NumberField
          label="Line spacing"
          value={Math.round(format.leading * 100) / 100}
          min={1}
          max={300}
          step={0.5}
          disabled={disabled}
          onCommit={(leading) => void apply({ leading })}
        />
      </label>

      {target.kind === "editor" && target.box && (
        <div className="format-row">
          <button
            type="button"
            data-testid="edit-split"
            title="The text after the caret becomes a new text box"
            disabled={disabled}
            // Keep the caret where it is in the editor.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editSession.split(documentId)}
          >
            Split at caret
          </button>
        </div>
      )}

      {target.kind === "box" && overflow?.page === target.page && overflow.id === target.box.id && (
        <p className="format-overflow" role="alert" data-testid="overflow-note">
          This text runs into {overflow.text}. Drag the handle on the box&apos;s right edge to
          change its width (the text wraps to fit), shorten the text, or undo (Ctrl+Z).
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="format-warnings" data-testid="font-warnings">
          {warnings.map((w) => (
            <li key={w.text} className={w.level} role={w.level === "error" ? "alert" : undefined}>
              {w.text}
            </li>
          ))}
        </ul>
      )}
      <BoxesToggle />
    </section>
  );
}

/** Acrobat's "Show bounding boxes": outlines on every box, or only the hovered one. */
function BoxesToggle() {
  const on = useShowBoxes();
  return (
    <label className="format-row format-check">
      <input
        type="checkbox"
        data-testid="edit-show-boxes"
        checked={on}
        onChange={(e) => boundingBoxes.set(e.target.checked)}
      />
      <span>Show bounding boxes</span>
    </label>
  );
}

/** A number box that applies on Enter or when it loses focus (not on every key). */
function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onCommit(v: number): void;
}) {
  const [text, setText] = useState(String(props.value));
  const [shown, setShown] = useState(props.value);
  if (shown !== props.value) {
    setShown(props.value);
    setText(String(props.value));
  }
  const commit = () => {
    const v = Number(text);
    if (!text.trim() || !Number.isFinite(v) || v === props.value) {
      setText(String(props.value));
      return;
    }
    props.onCommit(Math.min(props.max, Math.max(props.min, v)));
  };
  return (
    <input
      type="number"
      aria-label={props.label}
      value={text}
      min={props.min}
      max={props.max}
      step={props.step}
      disabled={props.disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

/** Colour input that applies when the picker closes (its native change), not while dragging. */
function ColorField(props: { value: string; disabled: boolean; onCommit(hex: string): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef(props.onCommit);
  useEffect(() => {
    latest.current = props.onCommit;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => latest.current(el.value);
    el.addEventListener("change", on);
    return () => el.removeEventListener("change", on);
  }, []);
  return (
    <input
      ref={ref}
      key={props.value}
      type="color"
      aria-label="Text color"
      defaultValue={props.value}
      disabled={props.disabled}
    />
  );
}
