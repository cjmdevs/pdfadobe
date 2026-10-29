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
import type {
  EditTextBox,
  PlainParagraphStyle,
  PlainStyle,
  RetypesetResult,
  Rgba,
  RichText,
} from "../../engine/edit";
import { parsePdfFontName } from "../../engine/edit/fonts";
import { pageOp } from "../../app/pages";
import { useWorkbench } from "../../app/workbench";
import { fontIndex, type FontIndex } from "../../app/fontIndex";
import { platform } from "../../platform";
import { fontOptions, resolveFont, type Section, type Warning } from "./fontChoices";
import {
  boundingBoxes,
  editSession,
  frameSettings,
  newTextStyle,
  useAddingText,
  useEditSelection,
  useEditSession,
  useNewTextStyle,
  usePageInfo,
  useOverflowNote,
  usePendingImage,
  useCaretFormat,
  useLinkMode,
  useShowBoxes,
} from "./editStore";
import { fontNameOf, NEW_TEXT_STYLE } from "./TextEditor";
import { BULLET_STYLES, NUMBER_STYLES, type NumberStyle } from "../../engine/edit/lists";
import { INDENT_STEP, type CharFmt, type ParaFmt } from "./richModel";
import { ImageFields, PushOption, TextBoxFields } from "./BoxFields";
import { ObjectsPanel } from "./ObjectsPanel";
import { LinkPanel } from "./LinkPanel";
import { useDocumentState } from "@embedpdf/core/react";
import { NumberField } from "./NumberField";
import {
  afterTextEdit,
  deleteSelection,
  reportTextEdit,
  textEditOpts,
  joinSelection,
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
interface Format extends Omit<PlainParagraphStyle, "fontName" | "marker"> {
  fontKey: string;
  script?: "super" | "sub" | undefined;
}

/** What a change sets on characters, and on paragraphs. */
const CHAR_KEYS = [
  "size",
  "color",
  "bold",
  "italic",
  "underline",
  "script",
  "hScale",
  "charSpacing",
  "wordSpacing",
  "kerning",
] as const;
const PARA_KEYS = ["align", "leading", "indent", "spaceBefore", "spaceAfter", "list"] as const;

export default function EditPanel({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const sel = useEditSelection(documentId);
  const session = useEditSession(documentId);
  const adding = useAddingText(documentId);
  const placing = usePendingImage(documentId);
  const overflow = useOverflowNote(documentId);
  const caret = useCaretFormat(documentId);
  const linking = useLinkMode(documentId);
  const docState = useDocumentState(documentId);
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

  // The Link tool has its own panel.
  if (linking)
    return (
      <LinkPanel
        documentId={documentId}
        current={linking.current}
        pageCount={docState?.document?.pageCount ?? 1}
      />
    );

  // Several boxes and images picked with Ctrl+click: align them; text alone can join.
  if (!session && sel && (sel.more?.length || sel.images?.length)) {
    const n = 1 + (sel.more?.length ?? 0) + (sel.images?.length ?? 0);
    const textOnly = sel.kind === "text" && !sel.images?.length;
    return (
      <section className="tool-panel" aria-label="Edit PDF" data-testid="edit-panel">
        <h3 className="tool-panel-title">Edit PDF</h3>
        <p data-testid="edit-selection">
          {textOnly ? `${n} text boxes` : `${n} objects`} selected on page {sel.page + 1}.
          Ctrl+click an object to add or remove it.
        </p>
        {textOnly && (
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
        )}
        <ObjectsPanel documentId={documentId} sel={sel} />
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
              Image on page {sel.page + 1}: drag to move (arrow keys: 1 pt, Shift: 10 pt), corners
              to resize, the round handle to rotate (Shift: 15° steps).
            </p>
            {info && (
              <ImageFields
                documentId={documentId}
                page={sel.page}
                pageHeight={info.height}
                image={image}
                disabled={wb.busy !== null}
              />
            )}
            <ObjectsPanel documentId={documentId} sel={sel} image={image} />
            <div className="format-row">
              <button
                type="button"
                disabled={wb.busy !== null}
                onClick={() => void deleteSelection(wb, documentId, sel)}
              >
                Delete image
              </button>
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
  // While typing: the format where the caret is.
  const fromCaret = (): Format => {
    const c = caret?.char ?? {};
    const { font: _f, fontName, fontKey, script, ...rest } = c;
    void _f;
    return {
      ...base,
      ...rest,
      ...caret?.para,
      ...(script ? { script } : { script: undefined }),
      fontKey: fontKey ?? (fontName ? keyForPdfFont(fontName) : base.fontKey),
    } as Format;
  };
  const format: Format = target.kind === "editor" && caret ? fromCaret() : base;
  const text = box ? box.paragraphs.join(" ") : "";

  /** Applies a change to the target: the editor, new text, or the selected box (one undo step). */
  async function apply(change: Partial<Format>, step?: 1 | -1) {
    if (!target) return;
    const next = { ...format, ...change };
    const char: CharFmt = {};
    for (const k of CHAR_KEYS) if (k in change) Object.assign(char, { [k]: next[k] });
    const para: ParaFmt = {};
    for (const k of PARA_KEYS) if (k in change) Object.assign(para, { [k]: next[k] });
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
      char.font = r.font;
      char.fontName = fontNameOf(r.font, own?.fontName ?? "Helvetica");
      char.fontKey = next.fontKey;
    } else setWarnings([]);

    if (target.kind === "editor") {
      editSession.format(documentId, {
        ...(Object.keys(char).length ? { char } : {}),
        ...(Object.keys(para).length ? { para } : {}),
        ...(step ? { indent: step } : {}),
      });
      return;
    }
    const { fontName: _n, fontKey: _k, script, ...plainChar } = char;
    void _n;
    void _k;
    const override: Partial<PlainStyle> = {
      ...plainChar,
      ...(script !== undefined ? (script ? { script } : {}) : {}),
      ...(para as Partial<PlainStyle>),
    };
    if (target.kind === "new") {
      const ind = newBase.indent ?? { first: 0, left: 0 };
      const by = step ? Math.max(step * INDENT_STEP, -Math.min(ind.first, ind.left)) : 0;
      newTextStyle.set({
        style: {
          ...newBase,
          ...override,
          ...(step ? { indent: { ...ind, first: ind.first + by, left: ind.left + by } } : {}),
        },
        fontKey: next.fontKey,
      });
      return;
    }
    const b = target.box;
    const page = target.page;
    // The box's own runs stay, less what this change sets for all of it.
    const changed = new Set(Object.keys(plainChar));
    const rich: RichText[] = b.paragraphs.map((t, i) => ({
      text: t,
      runs: (b.runs[i] ?? []).map((r) => ({
        start: r.start,
        end: r.end,
        style: Object.fromEntries(
          Object.entries({
            font: { kind: "original" as const, name: r.fontName },
            size: r.size,
            color: r.color,
            bold: r.bold,
            italic: r.italic,
            ...(r.script ? { script: r.script } : {}),
          }).filter(([k]) => !changed.has(k)),
        ),
      })),
    }));
    const styles = b.styles.map((s): Partial<PlainStyle> => {
      if (!step) return override;
      const ind = s.indent ?? { first: 0, left: 0 };
      const by = Math.max(step * INDENT_STEP, -Math.min(ind.first, ind.left));
      return {
        ...override,
        indent: { ...ind, first: ind.first + by, left: ind.left + by },
        ...(s.marker ? { marker: { ...s.marker, at: s.marker.at + by } } : {}),
      };
    });
    setWorking(true);
    let hit: string | null = null;
    let result: RetypesetResult | null = null;
    await wb.edit(
      documentId,
      "Change text style",
      async (bytes) => {
        const r = await pageOp(
          "editText",
          bytes,
          { page, id: b.id, preview: b.preview },
          rich,
          styles,
          undefined,
          textEditOpts(),
        );
        result = r.result;
        hit = afterTextEdit(
          wb,
          documentId,
          page,
          r.result,
          frameSettings.get(wb.meta[documentId]?.storeId, page, b),
        );
        return r.bytes;
      },
      { page },
    );
    setWorking(false);
    reportTextEdit(wb, result, hit);
  }

  const disabled = working || wb.busy !== null;
  const known = options.some((o) => o.key === format.fontKey);
  const sections = (["document", "standard", "firm", "windows"] as const).filter((s) =>
    options.some((o) => o.section === s),
  );
  const pressed = (on: boolean) => `format-toggle${on ? " pressed" : ""}`;
  const toggle = (name: string, prop: "bold" | "italic" | "underline", label: string) => (
    <button
      type="button"
      className={pressed(format[prop])}
      aria-label={label}
      aria-pressed={format[prop]}
      title={label}
      disabled={disabled}
      onClick={() => void apply({ [prop]: !format[prop] })}
    >
      {name}
    </button>
  );
  const scriptButton = (value: "super" | "sub", label: string, glyph: string) => (
    <button
      type="button"
      className={pressed(format.script === value)}
      aria-label={label}
      aria-pressed={format.script === value}
      title={label}
      disabled={disabled}
      onClick={() => void apply({ script: format.script === value ? undefined : value })}
    >
      {glyph}
    </button>
  );
  const list = format.list ?? null;
  const multiple = format.size > 0 ? Math.round((format.leading / format.size) * 100) / 100 : 1.2;
  const ind = format.indent ?? { first: 0, left: 0 };

  return (
    <section className="tool-panel edit-format" aria-label="Edit PDF" data-testid="edit-panel">
      <h3 className="tool-panel-title">Format</h3>
      <p className="small muted" data-testid="edit-target">
        {target.kind === "new"
          ? "New text: click on the page to place it, drag to set its width. Esc cancels."
          : target.kind === "editor"
            ? "Editing: select text to format part of it (no selection: the whole box)."
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
        {scriptButton("super", "Superscript", "T¹")}
        {scriptButton("sub", "Subscript", "T₁")}
      </div>

      <div className="format-row" role="group" aria-label="Lists and indents">
        <button
          type="button"
          className={pressed(list?.kind === "bullet")}
          aria-label="Bulleted list"
          aria-pressed={list?.kind === "bullet"}
          title="Bulleted list"
          disabled={disabled}
          onClick={() =>
            void apply({ list: list?.kind === "bullet" ? null : { kind: "bullet", glyph: "•" } })
          }
        >
          •≡
        </button>
        <select
          aria-label="Bullet style"
          title="Bullet style"
          value={list?.kind === "bullet" ? list.glyph : ""}
          disabled={disabled}
          onChange={(e) => void apply({ list: { kind: "bullet", glyph: e.target.value } })}
        >
          <option value="" disabled>
            ▾
          </option>
          {BULLET_STYLES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={pressed(list?.kind === "number")}
          aria-label="Numbered list"
          aria-pressed={list?.kind === "number"}
          title="Numbered list"
          disabled={disabled}
          onClick={() =>
            void apply({ list: list?.kind === "number" ? null : { kind: "number", format: "1." } })
          }
        >
          1≡
        </button>
        <select
          aria-label="Number style"
          title="Number style"
          value={list?.kind === "number" ? list.format : ""}
          disabled={disabled}
          onChange={(e) =>
            void apply({ list: { kind: "number", format: e.target.value as NumberStyle } })
          }
        >
          <option value="" disabled>
            ▾
          </option>
          {NUMBER_STYLES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="format-toggle"
          aria-label="Decrease indent"
          title="Decrease indent"
          disabled={disabled}
          onClick={() => void apply({}, -1)}
        >
          ⇤
        </button>
        <button
          type="button"
          className="format-toggle"
          aria-label="Increase indent"
          title="Increase indent"
          disabled={disabled}
          onClick={() => void apply({}, 1)}
        >
          ⇥
        </button>
      </div>

      <div className="format-row" role="group" aria-label="Alignment">
        {ALIGNS.map(([value, label, letter]) => (
          <button
            key={value}
            type="button"
            className={pressed(format.align === value)}
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

      <div className="format-row format-grid">
        <label title="Line spacing, as a multiple of the font size">
          <span>Line spacing</span>
          <NumberField
            label="Line spacing"
            value={multiple}
            min={0.5}
            max={5}
            step={0.05}
            disabled={disabled}
            onCommit={(v) => void apply({ leading: Math.round(v * format.size * 100) / 100 })}
          />
        </label>
        <label title="Space after each paragraph (points)">
          <span>Paragraph spacing</span>
          <NumberField
            label="Paragraph spacing"
            value={format.spaceAfter ?? 0}
            min={0}
            max={144}
            step={1}
            disabled={disabled}
            onCommit={(spaceAfter) => void apply({ spaceAfter })}
          />
        </label>
        <label title="Horizontal scaling (percent)">
          <span>Scaling %</span>
          <NumberField
            label="Horizontal scaling"
            value={format.hScale ?? 100}
            min={10}
            max={400}
            step={1}
            disabled={disabled}
            onCommit={(hScale) => void apply({ hScale })}
          />
        </label>
        <label title="Character spacing (thousandths of an em)">
          <span>Char. spacing</span>
          <NumberField
            label="Character spacing"
            value={format.charSpacing ?? 0}
            min={-500}
            max={2000}
            step={10}
            disabled={disabled}
            onCommit={(charSpacing) => void apply({ charSpacing })}
          />
        </label>
      </div>

      <details className="format-more">
        <summary>More spacing and indents</summary>
        <div className="format-row format-grid">
          <label title="First line, from the box's left edge (points)">
            <span>First line</span>
            <NumberField
              label="First-line indent"
              value={ind.first}
              min={0}
              max={600}
              step={1}
              disabled={disabled}
              onCommit={(first) => void apply({ indent: { ...ind, first } })}
            />
          </label>
          <label title="Other lines (a hanging indent when more than the first), points">
            <span>Left</span>
            <NumberField
              label="Left indent"
              value={ind.left}
              min={0}
              max={600}
              step={1}
              disabled={disabled}
              onCommit={(left) => void apply({ indent: { ...ind, left } })}
            />
          </label>
          <label title="Right indent (points)">
            <span>Right</span>
            <NumberField
              label="Right indent"
              value={ind.right ?? 0}
              min={0}
              max={600}
              step={1}
              disabled={disabled}
              onCommit={(right) => void apply({ indent: { ...ind, right } })}
            />
          </label>
          <label title="Space before the paragraph (points)">
            <span>Space before</span>
            <NumberField
              label="Space before"
              value={format.spaceBefore ?? 0}
              min={0}
              max={144}
              step={1}
              disabled={disabled}
              onCommit={(spaceBefore) => void apply({ spaceBefore })}
            />
          </label>
          <label title="Word spacing (thousandths of an em)">
            <span>Word spacing</span>
            <NumberField
              label="Word spacing"
              value={format.wordSpacing ?? 0}
              min={-500}
              max={2000}
              step={10}
              disabled={disabled}
              onCommit={(wordSpacing) => void apply({ wordSpacing })}
            />
          </label>
        </div>
        <label className="format-row format-check">
          <input
            type="checkbox"
            data-testid="edit-kerning"
            checked={format.kerning ?? false}
            disabled={disabled}
            onChange={(e) => void apply({ kerning: e.target.checked })}
          />
          <span>Kerning (fonts from files and the standard fonts; not a PDF&apos;s own)</span>
        </label>
      </details>

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
          This text runs into {overflow.text}. Drag the box&apos;s side handles to change its width
          (the text wraps to fit), turn on pushing the text below down, shorten the text, or undo
          (Ctrl+Z).
        </p>
      )}
      {target.kind === "box" && sel && (
        <ObjectsPanel documentId={documentId} sel={sel} box={target.box} />
      )}
      {target.kind === "box" && info && (
        <TextBoxFields
          documentId={documentId}
          page={target.page}
          pageHeight={info.height}
          box={target.box}
          disabled={disabled}
        />
      )}
      {target.kind === "editor" && <PushOption />}
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
