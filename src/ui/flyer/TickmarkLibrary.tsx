// Workpaper library (Phase 4), in three tabs (owner feedback 2026-10-27: the one long
// page was hard to follow):
// - Tickmarks: every tickmark by toolbar section; "New tickmark…" opens a short form with
//   a live preview. Built-in and firm ones are read-only; the user's own can be removed.
// - Sign-off stamps: the user's initials, every stamp, "New stamp…".
// - Firm & files: the firm file on the share, export/import of the settings file.
import { useState, type ReactNode } from "react";
import { useWorkbench } from "../../app/workbench";
import {
  TICK_SECTIONS,
  toBase64,
  type TickMark,
  type TickSection,
  type TickmarkDef,
} from "../../engine/flyer/tickmarks";
import { initialsOf } from "../../engine/flyer/userStamps";
import {
  mergeLibrary,
  mergeStamps,
  sanitizeStampTemplate,
  sanitizeTickmark,
} from "../../flyer/library";
import { platform } from "../../platform";
import { exportWorkpaperSettings, importWorkpaperSettings, readFirmTickmarks } from "./flyerFiles";
import { TickmarkIcon } from "./TickmarkIcon";

type Tab = "tickmarks" | "stamps" | "files";
type Kind = "symbol" | "text" | "letters" | "numbers" | "image";

const MARK_LABELS: Record<TickMark, string> = {
  check: "Check ✓",
  caretUp: "Caret ^ (footed)",
  caretLeft: "Caret < (cross-footed)",
};

/** A labelled form row with a one-line explanation under it. */
function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <label className="lib-field">
      <span className="lib-label">{label}</span>
      {children}
      <small className="muted">{help}</small>
    </label>
  );
}

export function TickmarkLibrary() {
  const [tab, setTab] = useState<Tab>("tickmarks");
  const [note, setNote] = useState<string | null>(null);
  const tabs: { id: Tab; label: string }[] = [
    { id: "tickmarks", label: "Tickmarks" },
    { id: "stamps", label: "Sign-off stamps" },
    { id: "files", label: "Firm & files" },
  ];
  return (
    <div className="tick-library">
      <p className="hint">
        Everything the Workpaper Tools toolbar can place. Your own tickmarks and stamps are added
        here and then show on the toolbar (your tickmarks under the section you pick).
      </p>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setNote(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "tickmarks" && <TickmarksTab onNote={setNote} />}
      {tab === "stamps" && <StampsTab onNote={setNote} />}
      {tab === "files" && <FilesTab onNote={setNote} />}
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

function TickmarksTab({ onNote }: { onNote: (n: string) => void }) {
  const { settings, updateSettings } = useWorkbench();
  const library = mergeLibrary(settings.firmTickmarksCache ?? [], settings.tickmarks);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [meaning, setMeaning] = useState("");
  const [kind, setKind] = useState<Kind>("symbol");
  const [mark, setMark] = useState<TickMark>("check");
  const [text, setText] = useState("");
  const [circle, setCircle] = useState(false);
  const [color, setColor] = useState("#D0021B");
  const [size, setSize] = useState(14);
  const [section, setSection] = useState<TickSection>("mine");
  const [image, setImage] = useState<TickmarkDef["image"] | null>(null);

  const draft: TickmarkDef | null = sanitizeTickmark({
    id: "draft",
    name: name || "New tickmark",
    meaning,
    color,
    size,
    section,
    ...(kind === "symbol" ? { mark, ...(text ? { text } : {}) } : {}),
    ...(kind === "text" ? { text } : {}),
    ...(kind === "letters" || kind === "numbers" ? { sequence: kind } : {}),
    ...(kind === "image" && image ? { image } : {}),
    circle: kind !== "image" && circle,
  });

  const add = () => {
    if (!draft || !name.trim()) return onNote("Give the tickmark a name and something to draw.");
    const def = { ...draft, id: `my.${crypto.randomUUID().slice(0, 8)}` };
    updateSettings({ tickmarks: [...settings.tickmarks, def] });
    const where = TICK_SECTIONS.find((x) => x.id === section)?.label ?? "Mine";
    onNote(`Added "${def.name}". It is on the toolbar under ${where}.`);
    setName("");
    setMeaning("");
    setText("");
    setImage(null);
    setAdding(false);
  };

  const pickImage = async () => {
    const [file] = await platform.pickFiles({ pictures: true });
    if (!file) return;
    if (file.bytes.byteLength > 250_000) return onNote("Use an image under 250 KB.");
    const mime = /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
    setImage({ mime, data: toBase64(new Uint8Array(file.bytes)) });
  };

  if (adding)
    return (
      <fieldset className="lib-form">
        <legend>New tickmark</legend>
        <div className="tick-preview" aria-label="Preview">
          {draft ? <TickmarkIcon def={draft} size={32} /> : <small>Nothing to draw yet</small>}
        </div>
        <Field label="Name" help="Shown in the toolbar lists and the Stamp Summary.">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Meaning" help="What it means; Acrobat shows it when the tickmark is clicked.">
          <input value={meaning} onChange={(e) => setMeaning(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Toolbar section" help="Which toolbar button lists it.">
          <select value={section} onChange={(e) => setSection(e.target.value as TickSection)}>
            {TICK_SECTIONS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kind" help="A drawn symbol, fixed letters, a count, or your own picture.">
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="symbol">Symbol (check or caret)</option>
            <option value="text">Letters or number (always the same)</option>
            <option value="letters">Letters counting up (A, B, C…)</option>
            <option value="numbers">Numbers counting up (1, 2, 3…)</option>
            <option value="image">Image (PNG or JPEG)</option>
          </select>
        </Field>
        {kind === "symbol" && (
          <Field label="Symbol" help="The mark drawn first.">
            <select value={mark} onChange={(e) => setMark(e.target.value as TickMark)}>
              {Object.entries(MARK_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        )}
        {(kind === "symbol" || kind === "text") && (
          <Field
            label={kind === "symbol" ? "Letters after it" : "Letters"}
            help={kind === "symbol" ? "Optional, up to 6 (e.g. GL)." : "Up to 6 (e.g. TB)."}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={6} />
          </Field>
        )}
        {kind === "image" && (
          <Field label="Image" help="A small PNG or JPEG under 250 KB.">
            <button type="button" onClick={() => void pickImage()}>
              {image ? "Change image…" : "Pick image…"}
            </button>
          </Field>
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
            <Field label="Color" help="Red is the firm default.">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Size (pt)" help="Height on the page; 14 matches the firm set.">
          <input
            type="number"
            min={6}
            max={72}
            value={size}
            onChange={(e) => setSize(Number(e.target.value) || 14)}
          />
        </Field>
        <div className="row">
          <button type="button" className="primary" onClick={add}>
            Add tickmark
          </button>
          <button type="button" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      </fieldset>
    );

  return (
    <>
      <button type="button" className="primary" onClick={() => setAdding(true)}>
        New tickmark…
      </button>
      {TICK_SECTIONS.map((sec) => {
        const list = library.filter((e) => (e.def.section ?? "mine") === sec.id);
        if (!list.length) return null;
        return (
          <section key={sec.id} className="lib-section">
            <h4>{sec.label}</h4>
            <ul className="tick-list">
              {list.map((e) => (
                <li key={e.def.id}>
                  <TickmarkIcon def={e.def} />
                  <span>
                    {e.def.name}
                    {e.def.meaning !== e.def.name && <small> ({e.def.meaning})</small>}
                  </span>
                  <small className="muted">{e.source}</small>
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
          </section>
        );
      })}
    </>
  );
}

function StampsTab({ onNote }: { onNote: (n: string) => void }) {
  const wb = useWorkbench();
  const { settings, updateSettings } = wb;
  const stamps = mergeStamps(settings.firmStampsCache ?? [], settings.stampTemplates);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("#1F4E9C");
  const [time, setTime] = useState(true);
  const [ref, setRef] = useState(true);
  const [fields, setFields] = useState("");

  const add = () => {
    const t = sanitizeStampTemplate({
      id: `my.${crypto.randomUUID().slice(0, 8)}`,
      title,
      kind: "status",
      color,
      showName: true,
      showDate: true,
      showTime: time,
      showRef: ref,
      fields: fields.split(",").map((f) => f.trim()),
    });
    if (!t) return onNote("Give the stamp a title.");
    updateSettings({ stampTemplates: [...settings.stampTemplates, t] });
    onNote(`Added the "${t.title}" stamp. It is in the Sign-off list on the toolbar.`);
    setTitle("");
    setFields("");
    setAdding(false);
  };

  return (
    <>
      <Field
        label="My initials"
        help="Printed on sign-off and Initials stamps. Empty: taken from your name."
      >
        <input
          value={settings.userInitials ?? ""}
          placeholder={initialsOf(wb.author)}
          maxLength={6}
          onChange={(e) => updateSettings({ userInitials: e.target.value.trim() || null })}
        />
      </Field>
      {adding ? (
        <fieldset className="lib-form">
          <legend>New sign-off stamp</legend>
          <Field label="Title" help='Printed in capitals at the top, e.g. "Partner review".'>
            <input
              autoFocus
              value={title}
              maxLength={40}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Color" help="Frame and text color.">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={time} onChange={(e) => setTime(e.target.checked)} />
            Print the time as well as the date
          </label>
          <label className="check">
            <input type="checkbox" checked={ref} onChange={(e) => setRef(e.target.checked)} />
            Ask for a W/P reference when placing
          </label>
          <Field
            label="Extra fields"
            help="Asked for when placing; separate with commas (e.g. Client no., Year)."
          >
            <input value={fields} onChange={(e) => setFields(e.target.value)} />
          </Field>
          <div className="row">
            <button type="button" className="primary" onClick={add}>
              Add stamp
            </button>
            <button type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </fieldset>
      ) : (
        <>
          <button type="button" className="primary" onClick={() => setAdding(true)}>
            New stamp…
          </button>
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
        </>
      )}
    </>
  );
}

function FilesTab({ onNote }: { onNote: (n: string) => void }) {
  const wb = useWorkbench();
  const { settings, updateSettings } = wb;
  const [path, setPath] = useState(settings.firmTickmarksPath ?? "");
  const loadFirm = async () => {
    const p = path.trim();
    if (!p) {
      updateSettings({ firmTickmarksPath: null, firmTickmarksCache: null, firmStampsCache: null });
      return onNote("No firm file: built-in and your own tickmarks only.");
    }
    try {
      const file = await readFirmTickmarks(p);
      updateSettings({
        firmTickmarksPath: p,
        firmTickmarksCache: file.tickmarks,
        firmStampsCache: file.stamps,
      });
      onNote(
        `Loaded ${file.tickmarks.length} firm tickmark(s) and ${file.stamps.length} stamp(s).`,
      );
    } catch (e) {
      onNote(`Could not load it: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <>
      <fieldset className="lib-form">
        <legend>Firm tickmarks and stamps</legend>
        <Field
          label="Firm file"
          help="A settings file on the network share. Everyone gets its tickmarks and stamps (read-only); the last copy is used offline."
        >
          <input
            value={path}
            placeholder="\\server\share\Workpaper settings.json"
            onChange={(e) => setPath(e.target.value)}
          />
        </Field>
        <button type="button" onClick={() => void loadFirm()}>
          Load
        </button>
      </fieldset>
      <fieldset className="lib-form">
        <legend>Settings file</legend>
        <p className="hint">
          One file with your tickmarks, stamps and calculator settings: to move them to another PC,
          share them, or make the firm file.
        </p>
        <div className="row">
          <button type="button" onClick={() => void exportWorkpaperSettings(wb)}>
            Export my tickmarks, stamps and calculator…
          </button>
          <button type="button" onClick={() => void importWorkpaperSettings(wb)}>
            Import…
          </button>
        </div>
      </fieldset>
    </>
  );
}
