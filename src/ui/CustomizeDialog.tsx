// Customize top bar (B8; quick tools since B4, laid out like Acrobat's dialog since B6).
// Every item of the top bar (Open, Save, page navigation, zoom, search, Preferences, ...)
// and every tool action can stay on the bar, move into a menu of the menu bar, or be
// hidden. The strip shows the bar left to right (drag to reorder; "Space" pushes what
// follows to the right); "Put it in" moves the picked item. Save stays greyed until
// something changes. Saved per user (settings.topBar); Reset to default goes back to the
// firm default (a layout file on the network share) or the built-in one.
import { useState } from "react";
import { MENUS, type MenuId } from "../app/appCommands";
import {
  BAR_SPACER,
  barItem,
  cleanLayout,
  effectiveLayout,
  hiddenItems,
  moveItem,
  placeOf,
  type TopBarLayout,
} from "../app/topBar";
import { useWorkbench } from "../app/workbench";
import { PlatformError, platform } from "../platform";
import {
  QUICK_DIVIDER,
  TOOLS,
  parseFirmLayout,
  resolveAction,
  type FirmLayout,
} from "../tools/registry";
import { parseFirmTopBar } from "../app/topBar";
import { Icon, type IconName } from "./Icon";
import { DragGhost } from "./kit/DragFeedback";
import { FormModal } from "./PageOpsDialogs";
import { usePointerDrag } from "./usePointerDrag";

type Place = "bar" | MenuId | "hidden";

function describe(id: string): { label: string; icon: IconName | null; where: string } {
  if (id === QUICK_DIVIDER) return { label: "Divider", icon: null, where: "" };
  if (id === BAR_SPACER) return { label: "Space (pushes the rest right)", icon: null, where: "" };
  const b = barItem(id);
  if (b) return { label: b.label, icon: b.icon, where: "" };
  const hit = resolveAction(id);
  return hit
    ? {
        label: hit.action.label,
        icon: hit.action.icon,
        where: hit.tool.unlisted ? "View" : hit.tool.name,
      }
    : { label: id, icon: null, where: "" };
}

const PLACES: { value: Place; label: string }[] = [
  { value: "bar", label: "Top bar" },
  ...MENUS.map((m) => ({ value: m.id as Place, label: `${m.label} menu` })),
  { value: "hidden", label: "Hidden" },
];

export function CustomizeDialog({ onClose }: { onClose: () => void }) {
  const wb = useWorkbench();
  const { settings, updateSettings } = wb;
  const [layout, setLayoutRaw] = useState<TopBarLayout>(() => effectiveLayout(settings));
  // Following the firm default: saving keeps it that way, so later changes to the firm
  // file still reach this user. Any edit here makes the layout the user's own.
  const [followFirm, setFollowFirm] = useState(
    settings.topBar === null && settings.quickToolbar === null,
  );
  const [changed, setChanged] = useState(false);
  const setLayout = (next: TopBarLayout) => {
    setFollowFirm(false);
    setChanged(true);
    setLayoutRaw(next);
  };
  /** The picked item (an id; dividers by their index on the bar). */
  const [picked, setPicked] = useState<{ id: string; at: number | null } | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [path, setPath] = useState(settings.firmLayoutPath ?? "");
  const [note, setNote] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const bar = layout.bar;
  const pickedAt = picked ? (picked.at ?? bar.indexOf(picked.id)) : -1;

  const reorder = (from: number, to: number) => {
    const next = [...bar];
    const [r] = next.splice(from, 1);
    if (r === undefined) return;
    const at = Math.max(0, Math.min(next.length, to > from ? to - 1 : to));
    next.splice(at, 0, r);
    const clean = cleanLayout({ bar: next, menus: layout.menus });
    if (!clean) return;
    setLayout(clean);
    setPicked({ id: r, at: r === QUICK_DIVIDER ? clean.bar.indexOf(r, at) : null });
  };
  const dropIndex = (under: Element | null, x: number): number | null => {
    const li = under?.closest<HTMLElement>("[data-pin]");
    if (!li) return null;
    const i = Number(li.dataset.pin);
    const r = li.getBoundingClientRect();
    return x < r.left + r.width / 2 ? i : i + 1;
  };
  const drag = usePointerDrag<number>({
    onMove: (_from, under, e) => setDropAt(dropIndex(under, e.clientX)),
    onCancel: () => setDropAt(null),
    onDrop: (from, under, e) => {
      setDropAt(null);
      const to = dropIndex(under, e.clientX);
      if (to !== null && to !== from && to !== from + 1) reorder(from, to);
    },
  });

  const place = (id: string, to: Place) => {
    if (id === BAR_SPACER) return;
    if (id === QUICK_DIVIDER) {
      if (to !== "bar" && pickedAt >= 0) {
        setLayout({ ...layout, bar: bar.filter((_, i) => i !== pickedAt) });
        setPicked(null);
      }
      return;
    }
    setLayout(moveItem(layout, id, to));
    setPicked({ id, at: null });
  };
  const addToBar = (id: string) => {
    const at = pickedAt >= 0 ? pickedAt + 1 : bar.indexOf(BAR_SPACER);
    setLayout(moveItem(layout, id, "bar", at));
    setPicked({ id, at: null });
  };
  const addDivider = () => {
    const at = pickedAt >= 0 ? pickedAt + 1 : bar.indexOf(BAR_SPACER);
    const next = [...bar];
    next.splice(at, 0, QUICK_DIVIDER);
    const clean = cleanLayout({ bar: next, menus: layout.menus });
    if (clean) setLayout(clean);
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
      const text = new TextDecoder().decode(file.bytes);
      const quick = parseFirmLayout(text);
      const top = parseFirmTopBar(text);
      updateSettings({ firmLayoutPath: p, firmLayoutCache: quick, firmTopBarCache: top });
      if (followFirm)
        setLayoutRaw(
          effectiveLayout({
            ...settings,
            topBar: null,
            quickToolbar: null,
            firmLayoutCache: quick,
            firmTopBarCache: top,
          }),
        );
      setNote("Loaded the firm default.");
    } catch (e) {
      setNote(`Could not load it: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const saveFirm = async () => {
    setNote(null);
    const p = path.trim();
    if (!p) return setNote("Enter where to save the firm layout file.");
    // Version 1 with the old quick tools kept, so older copies of the app still read it.
    const quick = bar.filter((r) => resolveAction(r) !== null);
    const file: FirmLayout & { topBar: TopBarLayout } = {
      version: 1,
      quickToolbar: quick,
      topBar: layout,
    };
    try {
      await platform.saveAs(p, null, new TextEncoder().encode(JSON.stringify(file, null, 2)));
      updateSettings({ firmLayoutPath: p, firmLayoutCache: quick, firmTopBarCache: layout });
      setNote("Saved. Everyone whose firm layout path points here gets this top bar.");
    } catch (e) {
      setNote(`Could not save it: ${e instanceof PlatformError ? e.message : String(e)}`);
    }
  };

  const offBar = [
    ...Object.keys(layout.menus),
    ...hiddenItems(layout).filter((id) => !(id in layout.menus)),
  ];
  const pickedPlace: Place | null = picked
    ? picked.id === QUICK_DIVIDER || picked.id === BAR_SPACER
      ? "bar"
      : placeOf(layout, picked.id)
    : null;
  const groups = TOOLS.filter((t) => t.toolbar.length);

  return (
    <FormModal
      title="Customize top bar"
      submit="Save"
      wide
      submitDisabled={!changed}
      onClose={onClose}
      onSubmit={() => {
        updateSettings({ topBar: followFirm ? null : layout, quickToolbar: null });
        onClose();
      }}
    >
      <div className="customize">
        <div className="strip-head">
          <span>Top bar, left to right</span>
          <span className="strip-controls">
            <button
              type="button"
              className="tool"
              title="Add divider"
              aria-label="Add divider"
              onClick={addDivider}
            >
              <Icon name="divider" />
            </button>
            <button
              type="button"
              className="tool"
              title="Move left"
              aria-label="Move left"
              disabled={pickedAt <= 0}
              onClick={() => reorder(pickedAt, pickedAt - 1)}
            >
              <Icon name="chevronLeft" />
            </button>
            <button
              type="button"
              className="tool"
              title="Move right"
              aria-label="Move right"
              disabled={pickedAt < 0 || pickedAt >= bar.length - 1}
              onClick={() => reorder(pickedAt, pickedAt + 2)}
            >
              <Icon name="chevronRight" />
            </button>
            <label className="place-select">
              Put it in{" "}
              <select
                aria-label="Put the picked item in"
                disabled={!picked || picked.id === BAR_SPACER}
                value={pickedPlace ?? "bar"}
                onChange={(e) => picked && place(picked.id, e.target.value as Place)}
              >
                {PLACES.filter(
                  (p) => picked?.id !== QUICK_DIVIDER || p.value === "bar" || p.value === "hidden",
                ).map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.value === "hidden" && picked && resolveAction(picked.id)
                      ? "Not shown"
                      : p.label}
                  </option>
                ))}
              </select>
            </label>
          </span>
        </div>
        <ol className="pin-strip" aria-label="Top bar items">
          {bar.map((r, i) => {
            const d = describe(r);
            return (
              <li
                key={r === QUICK_DIVIDER ? `|${i}` : r}
                data-pin={i}
                data-testid="pinned"
                className={
                  [
                    r === QUICK_DIVIDER ? "divider" : "",
                    r === BAR_SPACER ? "spacer" : "",
                    drag.source === i ? "dragging" : "",
                    dropAt === i ? "drop-before" : "",
                    dropAt === i + 1 && i === bar.length - 1 ? "drop-after" : "",
                  ]
                    .join(" ")
                    .trim() || undefined
                }
                onPointerDown={(e) => drag.start(e, i)}
              >
                <button
                  type="button"
                  className="tool"
                  title={d.where ? `${d.label} (${d.where})` : d.label}
                  aria-label={d.label}
                  aria-pressed={pickedAt === i}
                  onClick={() =>
                    setPicked(pickedAt === i ? null : { id: r, at: r === QUICK_DIVIDER ? i : null })
                  }
                >
                  {d.icon ? (
                    <Icon name={d.icon} />
                  ) : r === BAR_SPACER ? (
                    <span className="spacer-mark">↔</span>
                  ) : (
                    <span className="bar" />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        {drag.source !== null && (
          <DragGhost pos={drag.pos}>{describe(bar[drag.source] ?? "").label}</DragGhost>
        )}
        <div className="choose-head">In a menu, or hidden</div>
        <ul className="off-bar" aria-label="Items not on the top bar" data-testid="off-bar">
          {offBar.map((id) => (
            <li key={id}>
              <span className="off-label">
                {describe(id).icon && <Icon name={describe(id).icon ?? "info"} size={16} />}
                {describe(id).label}
              </span>
              <select
                aria-label={`Where ${describe(id).label} goes`}
                value={placeOf(layout, id)}
                onChange={(e) => place(id, e.target.value as Place)}
              >
                {PLACES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
          {!offBar.length && <li className="muted">Everything is on the top bar.</li>}
        </ul>
        <div className="choose-head">Tools you can add</div>
        <div className="choose">
          <ul className="tool-tree" role="tree" aria-label="Tools">
            {groups.map((t) => {
              const open = openGroups.has(t.id);
              const name = t.unlisted ? "View" : t.name;
              return (
                <li key={t.id} role="treeitem" aria-expanded={open} aria-selected={false}>
                  <button type="button" className="tree-head" onClick={() => toggle(t.id)}>
                    <span aria-hidden="true">{open ? "▾" : "▸"}</span> {name}
                  </button>
                  {open && (
                    <ul role="group">
                      {t.toolbar.map((a) => {
                        if (a.shown && !a.shown()) return null;
                        const ref = `${t.id}.${a.id}`;
                        const where = placeOf(layout, ref);
                        const placed = where !== "hidden";
                        return (
                          <li key={ref} role="treeitem" aria-selected={choice === ref}>
                            <button
                              type="button"
                              className="available-action"
                              aria-pressed={choice === ref}
                              disabled={placed}
                              onClick={() => setChoice(ref)}
                              onDoubleClick={() => {
                                addToBar(ref);
                                setChoice(null);
                              }}
                            >
                              <Icon name={a.icon} size={16} />
                              {a.label}
                              {a.items ? " ▾" : ""}
                              {where === "bar"
                                ? " (on the top bar)"
                                : placed
                                  ? ` (in the ${MENUS.find((m) => m.id === where)?.label} menu)`
                                  : ""}
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
            title="Add to the top bar"
            aria-label={
              choice ? `Add ${resolveAction(choice)?.action.label ?? ""}` : "Add to the top bar"
            }
            disabled={!choice || placeOf(layout, choice) !== "hidden"}
            onClick={() => {
              if (!choice) return;
              addToBar(choice);
              setChoice(null);
            }}
          >
            <Icon name="addToToolbar" />
          </button>
        </div>
        <div className="button-row inline">
          <button
            type="button"
            onClick={() => {
              setLayoutRaw(effectiveLayout({ ...settings, topBar: null, quickToolbar: null }));
              setFollowFirm(true);
              setChanged(true);
              setPicked(null);
              setNote("Back to the firm default (or the built-in one if there is none).");
            }}
          >
            Reset to default
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
            Save this top bar as the firm default
          </button>
        </div>
      </details>
      {note && (
        <p className="small" role="status" data-testid="customize-note">
          {note}
        </p>
      )}
    </FormModal>
  );
}
