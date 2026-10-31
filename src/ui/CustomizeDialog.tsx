// Customize Quick Tools (backlog B4; laid out as Acrobat's dialog since B6): the toolbar as
// a strip of icons with Add divider, Move left, Move right and Remove; "Choose tools to
// add" lists every tool's actions in groups that open and close, and the add button puts
// the chosen one on the strip. Save stays greyed until something changes. Saved per user
// (settings.quickToolbar). The firm default comes from a layout file on the network share
// (settings.firmLayoutPath); "Use firm default" goes back to it.
import { useState } from "react";
import { useWorkbench } from "../app/workbench";
import { PlatformError, platform } from "../platform";
import {
  QUICK_DIVIDER,
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
  const [changed, setChanged] = useState(false);
  const setRefs = (next: string[] | ((cur: string[]) => string[])) => {
    setFollowFirm(false);
    setChanged(true);
    setRefsRaw(next);
  };
  /** The strip item picked (index), and the action picked in the list ("tool.action"). */
  const [at, setAt] = useState<number | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [path, setPath] = useState(settings.firmLayoutPath ?? "");
  const [note, setNote] = useState<string | null>(null);

  const move = (from: number, to: number) => {
    setRefs((cur) => {
      const next = [...cur];
      const [r] = next.splice(from, 1);
      if (r) next.splice(Math.max(0, Math.min(next.length, to)), 0, r);
      return next;
    });
    setAt(Math.max(0, Math.min(refs.length - 1, to)));
  };
  const drag = usePointerDrag<number>({
    onMove: () => undefined,
    onCancel: () => undefined,
    onDrop: (from, under) => {
      const v = under?.closest<HTMLElement>("[data-pin]")?.dataset.pin;
      if (v !== undefined) move(from, Number(v));
    },
  });
  /** Puts `ref` after the picked strip item, or at the end. */
  const insert = (ref: string) => {
    const where = at === null ? refs.length : at + 1;
    setRefs((cur) => [...cur.slice(0, where), ref, ...cur.slice(where)]);
    setAt(where);
  };
  const toggle = (id: string) =>
    setOpenGroups((g) => {
      const next = new Set(g);
      if (!next.delete(id)) next.add(id);
      return next;
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

  const picked = at !== null ? refs[at] : undefined;
  const pickedLabel =
    picked === QUICK_DIVIDER ? "divider" : picked ? resolveAction(picked)?.action.label : "";
  const groups = TOOLS.filter((t) => t.toolbar.length && (isBuilt(t) || settings.showComingTools));

  return (
    <FormModal
      title="Customize Quick Tools"
      submit="Save"
      wide
      submitDisabled={!changed}
      onClose={onClose}
      onSubmit={() => {
        updateSettings({ quickToolbar: followFirm ? null : refs });
        onClose();
      }}
    >
      <div className="customize">
        <div className="strip-head">
          <span>Tools to show in Toolbar:</span>
          <span className="strip-controls">
            <button
              type="button"
              className="tool"
              title="Add divider"
              aria-label="Add divider"
              disabled={!refs.length || picked === QUICK_DIVIDER}
              onClick={() => insert(QUICK_DIVIDER)}
            >
              <Icon name="divider" />
            </button>
            <button
              type="button"
              className="tool"
              title="Move left"
              aria-label="Move left"
              disabled={at === null || at === 0}
              onClick={() => at !== null && move(at, at - 1)}
            >
              <Icon name="chevronLeft" />
            </button>
            <button
              type="button"
              className="tool"
              title="Move right"
              aria-label="Move right"
              disabled={at === null || at === refs.length - 1}
              onClick={() => at !== null && move(at, at + 1)}
            >
              <Icon name="chevronRight" />
            </button>
            <button
              type="button"
              className="tool"
              title={pickedLabel ? `Remove ${pickedLabel}` : "Remove from the toolbar"}
              aria-label="Remove from the toolbar"
              disabled={at === null}
              onClick={() => {
                if (at === null) return;
                setRefs((cur) => cur.filter((_, i) => i !== at));
                setAt(refs.length > 1 ? Math.min(at, refs.length - 2) : null);
              }}
            >
              <Icon name="trash" />
            </button>
          </span>
        </div>
        <ol className="pin-strip" aria-label="Pinned tools">
          {refs.map((r, i) => {
            const hit = r === QUICK_DIVIDER ? null : resolveAction(r);
            if (r !== QUICK_DIVIDER && !hit) return null;
            const label = hit ? hit.action.label : "Divider";
            return (
              <li
                key={`${r}${i}`}
                data-pin={i}
                data-testid="pinned"
                className={
                  [r === QUICK_DIVIDER ? "divider" : "", drag.source === i ? "dragging" : ""]
                    .join(" ")
                    .trim() || undefined
                }
                onPointerDown={(e) => drag.start(e, i)}
              >
                <button
                  type="button"
                  className="tool"
                  title={hit ? `${label} (${hit.tool.name})` : label}
                  aria-label={label}
                  aria-pressed={at === i}
                  onClick={() => setAt(at === i ? null : i)}
                >
                  {hit ? <Icon name={hit.action.icon} /> : <span className="bar" />}
                  {hit?.action.items ? <span className="caret">▾</span> : null}
                </button>
              </li>
            );
          })}
          {!refs.length && <li className="muted">Nothing on the toolbar.</li>}
        </ol>
        <div className="choose-head">Choose tools to add:</div>
        <div className="choose">
          <ul className="tool-tree" role="tree" aria-label="Tools">
            {groups.map((t) => {
              const open = openGroups.has(t.id);
              const name = t.unlisted ? "View" : t.name;
              return (
                <li key={t.id} role="treeitem" aria-expanded={open} aria-selected={false}>
                  <button type="button" className="tree-head" onClick={() => toggle(t.id)}>
                    <span aria-hidden="true">{open ? "▾" : "▸"}</span> {name}
                    {!isBuilt(t) && <span className="tool-coming"> · {comingLabel(t)}</span>}
                  </button>
                  {open && (
                    <ul role="group">
                      {t.toolbar.map((a) => {
                        if (a.shown && !a.shown()) return null;
                        const ref = `${t.id}.${a.id}`;
                        const pinned = refs.includes(ref);
                        return (
                          <li key={ref} role="treeitem" aria-selected={choice === ref}>
                            <button
                              type="button"
                              className="available-action"
                              aria-pressed={choice === ref}
                              disabled={pinned || !isBuilt(t)}
                              onClick={() => setChoice(ref)}
                              onDoubleClick={() => {
                                insert(ref);
                                setChoice(null);
                              }}
                            >
                              <Icon name={a.icon} size={16} />
                              {a.label}
                              {a.items ? " ▾" : ""}
                              {pinned ? " (on the toolbar)" : ""}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="tool add-to-toolbar"
            title="Add to the toolbar"
            aria-label={
              choice ? `Add ${resolveAction(choice)?.action.label ?? ""}` : "Add to the toolbar"
            }
            disabled={!choice || refs.includes(choice)}
            onClick={() => {
              if (!choice) return;
              insert(choice);
              setChoice(null);
            }}
          >
            <Icon name="addToToolbar" />
          </button>
        </div>
      </div>
      <details className="firm-layout">
        <summary>Firm default</summary>
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
              setChanged(true);
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
      </details>
    </FormModal>
  );
}
