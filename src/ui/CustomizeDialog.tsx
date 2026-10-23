// Customize the quick toolbar (backlog B4): add, remove and reorder any built tool action.
// Saved per user (settings.quickToolbar). The firm default comes from a layout file on the
// network share (settings.firmLayoutPath); "Use firm default" goes back to it.
import { useState } from "react";
import { useWorkbench } from "../app/workbench";
import { PlatformError, platform } from "../platform";
import {
  TOOLS,
  comingLabel,
  isBuilt,
  parseFirmLayout,
  resolveAction,
  type FirmLayout,
} from "../tools/registry";
import { Icon } from "./Icon";
import { FormModal } from "./PageOpsDialogs";
import { quickToolbarRefs } from "./Toolbar";
import { usePointerDrag } from "./usePointerDrag";

export function CustomizeDialog({ onClose }: { onClose: () => void }) {
  const wb = useWorkbench();
  const { settings, updateSettings } = wb;
  const [refs, setRefsRaw] = useState<string[]>(() => quickToolbarRefs(settings));
  // Following the firm default: saving keeps it that way, so later changes to the firm
  // file still reach this user. Any edit here makes the toolbar the user's own.
  const [followFirm, setFollowFirm] = useState(settings.quickToolbar === null);
  const setRefs = (next: string[] | ((cur: string[]) => string[])) => {
    setFollowFirm(false);
    setRefsRaw(next);
  };
  const [path, setPath] = useState(settings.firmLayoutPath ?? "");
  const [note, setNote] = useState<string | null>(null);

  const move = (from: number, to: number) =>
    setRefs((cur) => {
      const next = [...cur];
      const [r] = next.splice(from, 1);
      if (r) next.splice(Math.max(0, Math.min(next.length, to)), 0, r);
      return next;
    });
  const drag = usePointerDrag<number>({
    onMove: () => undefined,
    onCancel: () => undefined,
    onDrop: (from, under) => {
      const v = under?.closest<HTMLElement>("[data-pin]")?.dataset.pin;
      if (v !== undefined) move(from, Number(v));
    },
  });

  const loadFirm = async () => {
    setNote(null);
    const p = path.trim();
    if (!p) return setNote("Enter the path of the firm layout file first.");
    try {
      const file = await platform.readPath(p);
      const firm = parseFirmLayout(new TextDecoder().decode(file.bytes));
      updateSettings({ firmLayoutPath: p, firmLayoutCache: firm });
      if (followFirm) setRefsRaw(firm);
      setNote(`Loaded the firm default (${firm.length} tools).`);
    } catch (e) {
      setNote(`Could not load it: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const saveFirm = async () => {
    setNote(null);
    const p = path.trim();
    if (!p) return setNote("Enter where to save the firm layout file.");
    const layout: FirmLayout = { version: 1, quickToolbar: refs };
    try {
      await platform.saveAs(p, null, new TextEncoder().encode(JSON.stringify(layout, null, 2)));
      updateSettings({ firmLayoutPath: p, firmLayoutCache: refs });
      setNote("Saved. Everyone whose firm layout path points here gets this toolbar.");
    } catch (e) {
      setNote(`Could not save it: ${e instanceof PlatformError ? e.message : String(e)}`);
    }
  };

  return (
    <FormModal
      title="Customize quick toolbar"
      submit="Save"
      wide
      onClose={onClose}
      onSubmit={() => {
        updateSettings({ quickToolbar: followFirm ? null : refs });
        onClose();
      }}
    >
      <div className="customize">
        <section>
          <h3>On the quick toolbar</h3>
          <ol className="pin-list" aria-label="Pinned tools">
            {refs.map((r, i) => {
              const hit = resolveAction(r);
              if (!hit) return null;
              return (
                <li
                  key={r}
                  data-pin={i}
                  data-testid="pinned"
                  className={drag.source === i ? "dragging" : undefined}
                  onPointerDown={(e) => drag.start(e, i)}
                >
                  <Icon name={hit.action.icon} />
                  <span className="grow">
                    {hit.action.label}
                    <span className="muted small"> · {hit.tool.name}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Move ${hit.action.label} up`}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${hit.action.label} down`}
                    disabled={i === refs.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${hit.action.label}`}
                    onClick={() => setRefs((cur) => cur.filter((x) => x !== r))}
                  >
                    ×
                  </button>
                </li>
              );
            })}
            {!refs.length && <li className="muted">Nothing pinned.</li>}
          </ol>
          <p className="muted small">Drag to reorder.</p>
        </section>
        <section>
          <h3>Available</h3>
          <div className="available">
            {TOOLS.filter((t) => t.toolbar.length && (isBuilt(t) || settings.showComingTools)).map(
              (t) => (
                <div key={t.id} className="available-tool">
                  <div className="available-head">
                    {t.unlisted ? "View" : t.name}
                    {!isBuilt(t) && <span className="tool-coming"> · {comingLabel(t)}</span>}
                  </div>
                  {t.toolbar.map((a) => {
                    const ref = `${t.id}.${a.id}`;
                    const pinned = refs.includes(ref);
                    return (
                      <button
                        key={ref}
                        type="button"
                        className="available-action"
                        aria-label={`Add ${a.label}`}
                        disabled={pinned || !isBuilt(t)}
                        onClick={() => setRefs((cur) => [...cur, ref])}
                      >
                        <Icon name={a.icon} size={16} />
                        {a.label}
                        {a.items ? " ▾" : ""}
                        {pinned ? " (pinned)" : ""}
                      </button>
                    );
                  })}
                </div>
              ),
            )}
          </div>
        </section>
      </div>
      <fieldset>
        <legend>Firm default</legend>
        <label className="field-row">
          Layout file{" "}
          <input
            className="path-input"
            aria-label="Firm layout file"
            placeholder="\\\\server\\share\\PDFWorkbench\\layout.json"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
        <div className="button-row inline">
          <button type="button" onClick={() => void loadFirm()}>
            Load firm default
          </button>
          <button type="button" onClick={() => void saveFirm()}>
            Save this toolbar as the firm default
          </button>
          <button
            type="button"
            onClick={() => {
              setRefsRaw(quickToolbarRefs({ ...settings, quickToolbar: null }));
              setFollowFirm(true);
              setNote("Using the firm default (or the built-in one if there is none).");
            }}
          >
            Use firm default
          </button>
        </div>
        {note && (
          <p className="small" role="status" data-testid="customize-note">
            {note}
          </p>
        )}
      </fieldset>
    </FormModal>
  );
}
