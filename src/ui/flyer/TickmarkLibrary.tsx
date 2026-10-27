// Workpaper library (Phase 4): the built-in and firm tickmarks and sign-off stamps
// (read-only), the user's own (new tickmarks from a symbol, letters or an image; new stamp
// templates; removable), the user's initials, the firm file on the share, and the
// workpaper settings export/import.
import { useState } from "react";
import { useWorkbench } from "../../app/workbench";
import { toBase64, type TickMark, type TickmarkDef } from "../../engine/flyer/tickmarks";
import { initialsOf } from "../../engine/flyer/userStamps";
import { mergeLibrary, mergeStamps, sanitizeStampTemplate } from "../../flyer/library";
import { sanitizeTickmark } from "../../flyer/library";
import { platform } from "../../platform";
import { exportWorkpaperSettings, importWorkpaperSettings, readFirmTickmarks } from "./flyerFiles";
import { TickmarkIcon } from "./TickmarkIcon";

type Kind = "symbol" | "text" | "letters" | "numbers" | "image";

const MARK_LABELS: Record<TickMark, string> = {
  check: "Check ✓",
  caretUp: "Caret ^ (footed)",
  caretLeft: "Caret < (cross-footed)",
};

export function TickmarkLibrary() {
  const wb = useWorkbench();
  const { settings, updateSettings } = wb;
  const library = mergeLibrary(settings.firmTickmarksCache ?? [], settings.tickmarks);
  const [path, setPath] = useState(settings.firmTickmarksPath ?? "");
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [meaning, setMeaning] = useState("");
  const [kind, setKind] = useState<Kind>("symbol");
  const [mark, setMark] = useState<TickMark>("check");
  const [text, setText] = useState("");
  const [circle, setCircle] = useState(false);
  const [color, setColor] = useState("#D0021B");
  const [size, setSize] = useState(14);
  const [image, setImage] = useState<TickmarkDef["image"] | null>(null);
  const stamps = mergeStamps(settings.firmStampsCache ?? [], settings.stampTemplates);
  const [stTitle, setStTitle] = useState("");
  const [stColor, setStColor] = useState("#1F4E9C");
  const [stTime, setStTime] = useState(true);
  const [stRef, setStRef] = useState(true);
  const [stFields, setStFields] = useState("");

  const addStamp = () => {
    const t = sanitizeStampTemplate({
      id: `my.${crypto.randomUUID().slice(0, 8)}`,
      title: stTitle,
      kind: "status",
      color: stColor,
      showName: true,
      showDate: true,
      showTime: stTime,
      showRef: stRef,
      fields: stFields.split(",").map((f) => f.trim()),
    });
    if (!t) return setNote("Give the stamp a title.");
    updateSettings({ stampTemplates: [...settings.stampTemplates, t] });
    setNote(`Added the "${t.title}" stamp.`);
    setStTitle("");
    setStFields("");
  };

  const draft: TickmarkDef | null = sanitizeTickmark({
    id: "draft",
    name: name || "New tickmark",
    meaning,
    color,
    size,
    ...(kind === "symbol" ? { mark, ...(text ? { text } : {}) } : {}),
    ...(kind === "text" ? { text } : {}),
    ...(kind === "letters" || kind === "numbers" ? { sequence: kind } : {}),
    ...(kind === "image" && image ? { image } : {}),
    circle: kind !== "image" && circle,
  });

  const add = () => {
    if (!draft || !name.trim()) return setNote("Give the tickmark a name and something to draw.");
    const def = { ...draft, id: `my.${crypto.randomUUID().slice(0, 8)}` };
    updateSettings({ tickmarks: [...settings.tickmarks, def] });
    setNote(`Added "${def.name}".`);
    setName("");
    setMeaning("");
    setText("");
  };

  const pickImage = async () => {
    const [file] = await platform.pickFiles({ pictures: true });
    if (!file) return;
    if (file.bytes.byteLength > 250_000) return setNote("Use an image under 250 KB.");
    const mime = /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
    setImage({ mime, data: toBase64(new Uint8Array(file.bytes)) });
  };

  const loadFirm = async () => {
    setNote(null);
    const p = path.trim();
    if (!p) {
      updateSettings({ firmTickmarksPath: null, firmTickmarksCache: null, firmStampsCache: null });
      return setNote("No firm file: built-in and your own tickmarks only.");
    }
    try {
      const file = await readFirmTickmarks(p);
      updateSettings({
        firmTickmarksPath: p,
        firmTickmarksCache: file.tickmarks,
        firmStampsCache: file.stamps,
      });
      setNote(
        `Loaded ${file.tickmarks.length} firm tickmark(s) and ${file.stamps.length} stamp(s).`,
      );
    } catch (e) {
      setNote(`Could not load it: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="tick-library">
      <ul className="tick-list">
        {library.map((e) => (
          <li key={e.def.id}>
            <TickmarkIcon def={e.def} />
            <span>
              {e.def.name}
              {e.def.meaning !== e.def.name && <small> ({e.def.meaning})</small>}
            </span>
            <small className="muted">{e.source === "mine" ? "mine" : e.source}</small>
            {e.source === "mine" && (
              <button
                type="button"
                aria-label={`Remove ${e.def.name}`}
                title="Remove from my tickmarks (placed ones stay)"
                onClick={() =>
                  updateSettings({
                    tickmarks: settings.tickmarks.filter((t) => t.id !== e.def.id),
                  })
                }
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      <fieldset>
        <legend>New tickmark</legend>
        <label>
          Name <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <label>
          Meaning{" "}
          <input value={meaning} onChange={(e) => setMeaning(e.target.value)} maxLength={200} />
        </label>
        <label>
          Kind{" "}
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="symbol">Symbol</option>
            <option value="text">Letters or number (fixed)</option>
            <option value="letters">Letters counting up (A, B, C…)</option>
            <option value="numbers">Numbers counting up (1, 2, 3…)</option>
            <option value="image">Image (PNG or JPEG)</option>
          </select>
        </label>
        {kind === "symbol" && (
          <label>
            Symbol{" "}
            <select value={mark} onChange={(e) => setMark(e.target.value as TickMark)}>
              {Object.entries(MARK_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}
        {(kind === "symbol" || kind === "text") && (
          <label>
            {kind === "symbol" ? "Letters after it (optional)" : "Letters"}{" "}
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={6} />
          </label>
        )}
        {kind === "image" && (
          <button type="button" onClick={() => void pickImage()}>
            {image ? "Change image…" : "Pick image…"}
          </button>
        )}
        {kind !== "image" && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={circle}
                onChange={(e) => setCircle(e.target.checked)}
              />
              In a circle
            </label>
            <label>
              Color <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </label>
          </>
        )}
        <label>
          Size (pt){" "}
          <input
            type="number"
            min={6}
            max={72}
            value={size}
            onChange={(e) => setSize(Number(e.target.value) || 14)}
          />
        </label>
        <div className="tick-preview">{draft && <TickmarkIcon def={draft} size={28} />}</div>
        <button type="button" onClick={add}>
          Add to my tickmarks
        </button>
      </fieldset>

      <h3>Sign-off stamps</h3>
      <label>
        My initials{" "}
        <input
          value={settings.userInitials ?? ""}
          placeholder={initialsOf(wb.author)}
          maxLength={6}
          onChange={(e) => updateSettings({ userInitials: e.target.value.trim() || null })}
        />
      </label>
      <ul className="tick-list">
        {stamps.map((e) => (
          <li key={e.def.id}>
            <span style={{ color: e.def.color, fontWeight: 700 }}>
              {e.def.kind === "user" ? "JP" : "✎"}
            </span>
            <span>
              {e.def.title}
              {e.def.fields.length > 0 && <small> ({e.def.fields.join(", ")})</small>}
            </span>
            <small className="muted">{e.source}</small>
            {e.source === "mine" && (
              <button
                type="button"
                aria-label={`Remove ${e.def.title}`}
                onClick={() =>
                  updateSettings({
                    stampTemplates: settings.stampTemplates.filter((t) => t.id !== e.def.id),
                  })
                }
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <fieldset>
        <legend>New sign-off stamp</legend>
        <label>
          Title{" "}
          <input value={stTitle} maxLength={40} onChange={(e) => setStTitle(e.target.value)} />
        </label>
        <label>
          Color <input type="color" value={stColor} onChange={(e) => setStColor(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={stTime} onChange={(e) => setStTime(e.target.checked)} />
          Time
        </label>
        <label className="check">
          <input type="checkbox" checked={stRef} onChange={(e) => setStRef(e.target.checked)} />
          W/P reference
        </label>
        <label>
          Extra fields (comma-separated){" "}
          <input value={stFields} onChange={(e) => setStFields(e.target.value)} />
        </label>
        <button type="button" onClick={addStamp}>
          Add stamp
        </button>
      </fieldset>

      <fieldset>
        <legend>Firm tickmarks and stamps (network share, read-only)</legend>
        <label>
          Firm file{" "}
          <input
            value={path}
            placeholder="\\server\share\Workpaper settings.json"
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
        <button type="button" onClick={() => void loadFirm()}>
          Load
        </button>
      </fieldset>

      <div className="row">
        <button type="button" onClick={() => void exportWorkpaperSettings(wb)}>
          Export my tickmarks and stamps…
        </button>
        <button type="button" onClick={() => void importWorkpaperSettings(wb)}>
          Import…
        </button>
      </div>
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
