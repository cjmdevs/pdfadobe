// Add Header & Footer, Bates Numbering, Watermark and Background (Phase 7). Laid out
// like Acrobat's dialogs: font, margins and six header/footer boxes with insert buttons
// for page numbers, date and file name; saved setups; page range. Measurements are in
// inches here and points in the engine.
import { useRef, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useWorkbench } from "../../app/workbench";
import {
  STANDARD_FONTS,
  batesNumber,
  fillTokens,
  formatDate,
  type BatesSpec,
  type DateFormat,
  type FontName,
  type HeaderFooterSpec,
  type TextStyle,
} from "../../engine/decorate";
import { parseRanges, RangeSyntaxError } from "../../engine/pages/ranges";
import { platform } from "../../platform";
import { baseName } from "../../platform/types";
import { addBackground, addHeaderFooter, addWatermark, batesFiles } from "./decorateActions";

type What = "header" | "bates" | "watermark" | "background";
const IN = 72;
const FONTS = Object.keys(STANDARD_FONTS) as FontName[];
const DATE_FORMATS: DateFormat[] = ["M/D/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "MMMM D, YYYY"];

function StyleFields({ style, onChange }: { style: TextStyle; onChange(s: TextStyle): void }) {
  return (
    <div className="row">
      <label>
        Font
        <select
          value={style.font}
          onChange={(e) => onChange({ ...style, font: e.target.value as FontName })}
        >
          {FONTS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
      <label>
        Size
        <input
          type="number"
          min={4}
          max={200}
          value={style.size}
          onChange={(e) => onChange({ ...style, size: Number(e.target.value) || style.size })}
        />
      </label>
      <label>
        Colour
        <input
          type="color"
          value={style.color}
          onChange={(e) => onChange({ ...style, color: e.target.value })}
        />
      </label>
    </div>
  );
}

/** "All pages" or a typed range; returns null (all) or 0-based pages, or throws. */
function PageRange({
  value,
  onChange,
}: {
  value: string | null;
  onChange(v: string | null): void;
}) {
  return (
    <fieldset className="row">
      <legend>Pages</legend>
      <label>
        <input type="radio" checked={value === null} onChange={() => onChange(null)} />
        All pages
      </label>
      <label>
        <input type="radio" checked={value !== null} onChange={() => onChange("")} />
        Pages
      </label>
      {value !== null && (
        <input
          type="text"
          aria-label="Page range"
          placeholder="e.g. 1-3, 5"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </fieldset>
  );
}

export function DecorateDialog({
  what,
  documentId,
  onClose,
}: {
  what: What;
  documentId: string;
  onClose(): void;
}) {
  if (what === "watermark") return <WatermarkForm documentId={documentId} onClose={onClose} />;
  if (what === "background") return <BackgroundForm documentId={documentId} onClose={onClose} />;
  return <HeaderFooterForm documentId={documentId} bates={what === "bates"} onClose={onClose} />;
}

function usePages(documentId: string) {
  const pageCount = useDocumentState(documentId)?.document?.pageCount ?? 0;
  const [range, setRange] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pages = (): number[] | undefined | false => {
    if (range === null) return undefined;
    try {
      setError(null);
      return parseRanges(range, pageCount);
    } catch (e) {
      setError(e instanceof RangeSyntaxError ? e.message : String(e));
      return false;
    }
  };
  return { range, setRange, error, pages, pageCount };
}

function HeaderFooterForm({
  documentId,
  bates,
  onClose,
}: {
  documentId: string;
  bates: boolean;
  onClose(): void;
}) {
  const wb = useWorkbench();
  const presets = wb.settings.headerFooterPresets.filter((p) => !!p.bates === bates);
  const [spec, setSpec] = useState<Omit<HeaderFooterSpec, "pages">>({
    header: ["", "", ""],
    footer: bates ? ["", "", "{bates}"] : ["", "", "Page {page} of {pages}"],
    style: { font: "Helvetica", size: 10, color: "#000000" },
    margins: { top: 0.5 * IN, bottom: 0.5 * IN, left: 0.5 * IN, right: 0.5 * IN },
    startNumber: 1,
    dateFormat: "M/D/YYYY",
  });
  const [b, setB] = useState<BatesSpec>({ prefix: "", start: 1, digits: 6, suffix: "" });
  const [preset, setPreset] = useState("");
  const [files, setFiles] = useState<
    { path: string | null; documentId: string | null; name: string }[]
  >(() => {
    const m = wb.meta[documentId];
    return [
      {
        path: m?.source.kind === "path" ? m.source.path : null,
        documentId,
        name: m?.name ?? "Document.pdf",
      },
    ];
  });
  const [done, setDone] = useState<number | null>(null);
  const range = usePages(documentId);
  const focused = useRef<{ row: "header" | "footer"; col: number }>({ row: "footer", col: 2 });

  const setBox = (row: "header" | "footer", col: number, text: string) => {
    const next = [...spec[row]] as [string, string, string];
    next[col] = text;
    setSpec({ ...spec, [row]: next });
  };
  const insert = (token: string) => {
    const { row, col } = focused.current;
    setBox(row, col, `${spec[row][col] ?? ""}${token}`);
  };
  const choosePreset = (name: string) => {
    setPreset(name);
    const p = presets.find((x) => x.name === name);
    if (!p) return;
    setSpec(p.spec);
    if (p.bates) setB(p.bates);
  };
  const savePreset = () => {
    const name = window.prompt("Name for these settings:", preset || "My settings")?.trim();
    if (!name) return;
    const others = wb.settings.headerFooterPresets.filter((p) => p.name !== name);
    wb.updateSettings({
      headerFooterPresets: [...others, { name, spec, ...(bates ? { bates: b } : {}) }],
    });
    setPreset(name);
  };
  const deletePreset = () => {
    wb.updateSettings({
      headerFooterPresets: wb.settings.headerFooterPresets.filter((p) => p.name !== preset),
    });
    setPreset("");
  };
  const addFiles = async () => {
    const picked = await platform.pickFiles();
    setFiles([
      ...files,
      ...picked
        .filter((f) => /\.pdf$/i.test(f.name))
        .map((f) =>
          f.source.kind === "path"
            ? { path: f.source.path, documentId: null, name: f.name }
            : { path: null, documentId: null, name: f.name, bytes: new Uint8Array(f.bytes) },
        ),
    ]);
  };

  const apply = async () => {
    const pages = range.pages();
    if (pages === false) return;
    const full: HeaderFooterSpec = { ...spec, ...(pages ? { pages } : {}) };
    if (bates && files.length > 1) {
      setDone(0);
      const next = await batesFiles(wb, files, full, b, setDone);
      if (next !== null) {
        wb.toast(
          `Bates numbered ${files.length} files (${batesNumber(b, b.start)} to ${batesNumber(b, next - 1)}), saved as _Bates copies. The originals are unchanged.`,
        );
        onClose();
      }
      return;
    }
    onClose();
    await addHeaderFooter(wb, documentId, full, bates ? b : undefined);
  };

  const sample = fillTokens(spec.footer[2] || spec.footer[1] || spec.footer[0], {
    page: spec.startNumber,
    pages: spec.startNumber + range.pageCount - 1,
    date: formatDate(new Date(), spec.dateFormat),
    file: wb.meta[documentId]?.name ?? "",
    bates: batesNumber(b, b.start),
  });

  return (
    <div className="decorate" data-testid={bates ? "bates-dialog" : "header-footer-dialog"}>
      <div className="row">
        <label>
          Saved settings
          <select value={preset} onChange={(e) => choosePreset(e.target.value)}>
            <option value="">(none)</option>
            {presets.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={savePreset}>
          Save Settings…
        </button>
        <button type="button" onClick={deletePreset} disabled={!preset}>
          Delete
        </button>
      </div>
      <StyleFields style={spec.style} onChange={(style) => setSpec({ ...spec, style })} />
      <fieldset className="row">
        <legend>Margins (inches)</legend>
        {(["top", "bottom", "left", "right"] as const).map((k) => (
          <label key={k}>
            {k[0]?.toUpperCase() + k.slice(1)}
            <input
              type="number"
              step={0.05}
              min={0}
              value={Number((spec.margins[k] / IN).toFixed(2))}
              onChange={(e) =>
                setSpec({
                  ...spec,
                  margins: { ...spec.margins, [k]: (Number(e.target.value) || 0) * IN },
                })
              }
            />
          </label>
        ))}
      </fieldset>
      {bates && (
        <fieldset className="row">
          <legend>Bates number</legend>
          <label>
            Prefix
            <input
              type="text"
              value={b.prefix}
              onChange={(e) => setB({ ...b, prefix: e.target.value })}
            />
          </label>
          <label>
            Start
            <input
              type="number"
              min={0}
              value={b.start}
              onChange={(e) =>
                setB({ ...b, start: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })
              }
            />
          </label>
          <label>
            Digits
            <input
              type="number"
              min={1}
              max={15}
              value={b.digits}
              onChange={(e) =>
                setB({
                  ...b,
                  digits: Math.min(15, Math.max(1, Math.trunc(Number(e.target.value) || 1))),
                })
              }
            />
          </label>
          <label>
            Suffix
            <input
              type="text"
              value={b.suffix}
              onChange={(e) => setB({ ...b, suffix: e.target.value })}
            />
          </label>
        </fieldset>
      )}
      <div className="row">
        <span>Insert:</span>
        {bates && (
          <button type="button" onClick={() => insert("{bates}")}>
            Bates Number
          </button>
        )}
        <button type="button" onClick={() => insert("{page}")}>
          Page Number
        </button>
        <button type="button" onClick={() => insert("Page {page} of {pages}")}>
          Page X of Y
        </button>
        <button type="button" onClick={() => insert("{date}")}>
          Date
        </button>
        <button type="button" onClick={() => insert("{file}")}>
          File Name
        </button>
      </div>
      {(["header", "footer"] as const).map((row) => (
        <fieldset key={row} className="hf-boxes">
          <legend>{row === "header" ? "Header" : "Footer"}</legend>
          {["Left", "Centre", "Right"].map((label, col) => (
            <label key={label}>
              {label} {row}
              <input
                type="text"
                value={spec[row][col] ?? ""}
                onFocus={() => (focused.current = { row, col })}
                onChange={(e) => setBox(row, col, e.target.value)}
              />
            </label>
          ))}
        </fieldset>
      ))}
      <div className="row">
        <label>
          Date format
          <select
            value={spec.dateFormat}
            onChange={(e) => setSpec({ ...spec, dateFormat: e.target.value as DateFormat })}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        {!bates && (
          <label>
            Start page number
            <input
              type="number"
              min={0}
              value={spec.startNumber}
              onChange={(e) =>
                setSpec({ ...spec, startNumber: Math.trunc(Number(e.target.value) || 0) })
              }
            />
          </label>
        )}
      </div>
      {!(bates && files.length > 1) && <PageRange value={range.range} onChange={range.setRange} />}
      {range.error && <p className="hint error">{range.error}</p>}
      {bates && (
        <fieldset>
          <legend>Files, numbered in this order</legend>
          <ol className="bates-files">
            {files.map((f, i) => (
              <li key={`${f.path ?? f.name}-${i}`}>
                {baseName(f.path ?? f.name)}
                {i > 0 && (
                  <button type="button" onClick={() => setFiles(files.filter((_, k) => k !== i))}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => void addFiles()}>
            Add Files…
          </button>
          {files.length > 1 && (
            <p className="hint">
              Each file is saved as a new &lt;name&gt;_Bates.pdf beside it; the originals are not
              changed.
            </p>
          )}
        </fieldset>
      )}
      <p className="hint" data-testid="decorate-preview">
        First page{sample ? `: ${sample}` : ""}
      </p>
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={() => void apply()}
          disabled={done !== null}
        >
          {done !== null ? `Numbering ${done + 1} of ${files.length}…` : "Apply"}
        </button>
      </div>
    </div>
  );
}

function WatermarkForm({ documentId, onClose }: { documentId: string; onClose(): void }) {
  const wb = useWorkbench();
  const [useImage, setUseImage] = useState(false);
  const [text, setText] = useState("DRAFT");
  const [style, setStyle] = useState<TextStyle>({
    font: "Helvetica Bold",
    size: 72,
    color: "#c00000",
  });
  const [image, setImage] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [scale, setScale] = useState(50);
  const [opacity, setOpacity] = useState(30);
  const [rotation, setRotation] = useState(45);
  const [behind, setBehind] = useState(false);
  const [h, setH] = useState<"left" | "center" | "right">("center");
  const [v, setV] = useState<"top" | "center" | "bottom">("center");
  const range = usePages(documentId);

  const pick = async () => {
    const [f] = await platform.pickFiles({ pictures: true });
    if (f) setImage({ name: f.name, bytes: new Uint8Array(f.bytes) });
  };
  const apply = async () => {
    const pages = range.pages();
    if (pages === false) return;
    if (useImage && !image) {
      wb.toast("Choose an image first.", "error");
      return;
    }
    onClose();
    await addWatermark(wb, documentId, {
      source: useImage && image ? { image: image.bytes, scale: scale / 100 } : { text, style },
      opacity: opacity / 100,
      rotation,
      behind,
      position: { h, v, dx: 0, dy: 0 },
      ...(pages ? { pages } : {}),
    });
  };
  return (
    <div className="decorate" data-testid="watermark-dialog">
      <fieldset>
        <legend>Source</legend>
        <label>
          <input type="radio" checked={!useImage} onChange={() => setUseImage(false)} />
          Text
          <input
            type="text"
            aria-label="Watermark text"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {!useImage && <StyleFields style={style} onChange={setStyle} />}
        <label>
          <input type="radio" checked={useImage} onChange={() => setUseImage(true)} />
          Image (JPEG or PNG)
        </label>
        {useImage && (
          <div className="row">
            <button type="button" onClick={() => void pick()}>
              Choose Image…
            </button>
            <span className="hint">{image?.name ?? "No image chosen"}</span>
            <label>
              Width (% of page)
              <input
                type="number"
                min={5}
                max={100}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value) || 50)}
              />
            </label>
          </div>
        )}
      </fieldset>
      <fieldset className="row">
        <legend>Appearance</legend>
        <label>
          Opacity {opacity}%
          <input
            type="range"
            min={5}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </label>
        <label>
          Rotation
          <select value={rotation} onChange={(e) => setRotation(Number(e.target.value))}>
            {[0, 45, 90, -45].map((r) => (
              <option key={r} value={r}>
                {r}°
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="radio" checked={behind} onChange={() => setBehind(true)} />
          Behind page
        </label>
        <label>
          <input type="radio" checked={!behind} onChange={() => setBehind(false)} />
          In front of page
        </label>
      </fieldset>
      <fieldset className="row">
        <legend>Position</legend>
        <label>
          Across
          <select value={h} onChange={(e) => setH(e.target.value as typeof h)}>
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label>
          Down
          <select value={v} onChange={(e) => setV(e.target.value as typeof v)}>
            <option value="top">Top</option>
            <option value="center">Centre</option>
            <option value="bottom">Bottom</option>
          </select>
        </label>
      </fieldset>
      <PageRange value={range.range} onChange={range.setRange} />
      {range.error && <p className="hint error">{range.error}</p>}
      <div className="row">
        <button type="button" className="primary" onClick={() => void apply()}>
          Apply
        </button>
      </div>
    </div>
  );
}

function BackgroundForm({ documentId, onClose }: { documentId: string; onClose(): void }) {
  const wb = useWorkbench();
  const [useImage, setUseImage] = useState(false);
  const [color, setColor] = useState("#fff8dc");
  const [image, setImage] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [scale, setScale] = useState(100);
  const [opacity, setOpacity] = useState(100);
  const range = usePages(documentId);
  const pick = async () => {
    const [f] = await platform.pickFiles({ pictures: true });
    if (f) setImage({ name: f.name, bytes: new Uint8Array(f.bytes) });
  };
  const apply = async () => {
    const pages = range.pages();
    if (pages === false) return;
    if (useImage && !image) {
      wb.toast("Choose an image first.", "error");
      return;
    }
    onClose();
    await addBackground(wb, documentId, {
      source: useImage && image ? { image: image.bytes, scale: scale / 100 } : { color },
      opacity: opacity / 100,
      ...(pages ? { pages } : {}),
    });
  };
  return (
    <div className="decorate" data-testid="background-dialog">
      <fieldset>
        <legend>Source</legend>
        <label>
          <input type="radio" checked={!useImage} onChange={() => setUseImage(false)} />
          Colour
          <input
            type="color"
            aria-label="Background colour"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          <input type="radio" checked={useImage} onChange={() => setUseImage(true)} />
          Image (JPEG or PNG)
        </label>
        {useImage && (
          <div className="row">
            <button type="button" onClick={() => void pick()}>
              Choose Image…
            </button>
            <span className="hint">{image?.name ?? "No image chosen"}</span>
            <label>
              Width (% of page)
              <input
                type="number"
                min={5}
                max={100}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value) || 100)}
              />
            </label>
          </div>
        )}
      </fieldset>
      <label>
        Opacity {opacity}%
        <input
          type="range"
          min={5}
          max={100}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
        />
      </label>
      <PageRange value={range.range} onChange={range.setRange} />
      {range.error && <p className="hint error">{range.error}</p>}
      <p className="hint">The background is drawn behind everything on the page.</p>
      <div className="row">
        <button type="button" className="primary" onClick={() => void apply()}>
          Apply
        </button>
      </div>
    </div>
  );
}
