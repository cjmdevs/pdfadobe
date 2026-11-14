// Top bar layout (B8). Every item (Open, Save, page navigation, zoom, search, ...) and
// every pinned tool action can sit on the bar, in a menu of the menu bar, or be hidden.
// Saved per user (settings.topBar); null follows the firm default (layout file), else
// the built-in default. Pure logic, no DOM.
import type { IconName } from "../ui/Icon";
import {
  DEFAULT_QUICK_TOOLBAR,
  QUICK_DIVIDER,
  cleanQuickToolbar,
  resolveAction,
} from "../tools/registry";
import type { MenuId } from "./appCommands";

export interface TopBarLayout {
  /** Left to right; QUICK_DIVIDER for a divider; BAR_SPACER pushes the rest right. */
  bar: string[];
  /** Items listed at the end of a menu instead. */
  menus: Record<string, MenuId>;
}

export const BAR_SPACER = "bar:spacer";

export interface BarItemDef {
  id: string;
  label: string;
  icon: IconName;
  /** Only shown while a document is open. */
  docOnly: boolean;
}

/** The built-in items, in their default order. */
export const BAR_ITEMS: BarItemDef[] = [
  { id: "bar:open", label: "Open", icon: "open", docOnly: false },
  { id: "bar:save", label: "Save", icon: "save", docOnly: false },
  { id: "bar:print", label: "Print", icon: "print", docOnly: false },
  { id: "bar:find", label: "Find", icon: "search", docOnly: false },
  { id: "bar:undo", label: "Undo", icon: "undo", docOnly: true },
  { id: "bar:redo", label: "Redo", icon: "redo", docOnly: true },
  { id: "bar:pageNav", label: "Page navigation", icon: "next", docOnly: true },
  { id: "bar:zoom", label: "Zoom", icon: "zoomIn", docOnly: true },
  { id: "bar:hand", label: "Hand tool", icon: "hand", docOnly: true },
  { id: "bar:search", label: "Search", icon: "search", docOnly: false },
  { id: "bar:viewMode", label: "Page display", icon: "pages", docOnly: true },
  { id: "bar:properties", label: "Document properties", icon: "info", docOnly: false },
  { id: "bar:help", label: "Help", icon: "help", docOnly: false },
  { id: "bar:theme", label: "Theme", icon: "theme", docOnly: false },
  { id: "bar:preferences", label: "Preferences", icon: "settings", docOnly: false },
  { id: "bar:customize", label: "Customize top bar", icon: "customize", docOnly: false },
  { id: "bar:toolsPane", label: "Tools pane", icon: "tools", docOnly: false },
];

export function barItem(id: string): BarItemDef | undefined {
  return BAR_ITEMS.find((b) => b.id === id);
}

/** The firm's built-in default, with the given quick tools after zoom. */
export function defaultLayout(quick: string[] = DEFAULT_QUICK_TOOLBAR): TopBarLayout {
  return {
    bar: [
      "bar:open",
      "bar:save",
      "bar:print",
      "bar:find",
      QUICK_DIVIDER,
      "bar:undo",
      "bar:redo",
      QUICK_DIVIDER,
      "bar:pageNav",
      "bar:zoom",
      ...(quick.length ? [QUICK_DIVIDER, ...quick] : []),
      BAR_SPACER,
      "bar:search",
      "bar:viewMode",
      "bar:properties",
      "bar:toolsPane",
    ],
    menus: {},
  };
}

const MENU_IDS = new Set<string>(["file", "edit", "view", "window", "help"]);
const known = (id: string) => !!barItem(id) || resolveAction(id) !== null;

/**
 * Keeps known items once each (a menu placement loses to the bar), no leading, trailing
 * or doubled dividers, exactly one spacer. Unknown items (older or newer layouts) are
 * dropped, not errors. Null when `raw` is not a layout at all.
 */
export function cleanLayout(raw: unknown): TopBarLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { bar?: unknown; menus?: unknown };
  if (!Array.isArray(r.bar)) return null;
  const bar: string[] = [];
  for (const id of r.bar) {
    if (typeof id !== "string") continue;
    if (id === QUICK_DIVIDER) {
      const last = bar.at(-1);
      if (last !== undefined && last !== QUICK_DIVIDER && last !== BAR_SPACER) bar.push(id);
      continue;
    }
    if (id === BAR_SPACER) {
      if (bar.includes(id)) continue;
      if (bar.at(-1) === QUICK_DIVIDER) bar.pop();
      bar.push(id);
      continue;
    }
    if (!bar.includes(id) && known(id)) bar.push(id);
  }
  if (bar.at(-1) === QUICK_DIVIDER) bar.pop();
  if (!bar.includes(BAR_SPACER)) bar.push(BAR_SPACER);
  const menus: Record<string, MenuId> = {};
  if (r.menus && typeof r.menus === "object")
    for (const [id, m] of Object.entries(r.menus as Record<string, unknown>))
      if (typeof m === "string" && MENU_IDS.has(m) && known(id) && !bar.includes(id))
        menus[id] = m as MenuId;
  return { bar, menus };
}

/** The layout in effect: the user's, else the firm's, else the built-in one. */
export function effectiveLayout(s: {
  topBar: unknown;
  quickToolbar: string[] | null;
  firmTopBarCache: unknown;
  firmLayoutCache: string[] | null;
}): TopBarLayout {
  return (
    cleanLayout(s.topBar) ??
    // Before B8 users customized only the quick tools: keep theirs.
    (cleanQuickToolbar(s.quickToolbar)
      ? defaultLayout(cleanQuickToolbar(s.quickToolbar) ?? [])
      : null) ??
    cleanLayout(s.firmTopBarCache) ??
    defaultLayout(cleanQuickToolbar(s.firmLayoutCache) ?? DEFAULT_QUICK_TOOLBAR)
  );
}

/** Built-in items on neither the bar nor a menu. */
export function hiddenItems(l: TopBarLayout): string[] {
  return BAR_ITEMS.map((b) => b.id).filter((id) => !l.bar.includes(id) && !(id in l.menus));
}

/** Where an item is: "bar", a menu id, or "hidden". */
export function placeOf(l: TopBarLayout, id: string): "bar" | MenuId | "hidden" {
  if (l.bar.includes(id)) return "bar";
  return l.menus[id] ?? "hidden";
}

/** Moves an item to the bar (at `index`, default the end before the spacer), a menu, or hidden. */
export function moveItem(
  l: TopBarLayout,
  id: string,
  to: "bar" | MenuId | "hidden",
  index?: number,
): TopBarLayout {
  const bar = l.bar.filter((x) => x !== id);
  const menus: Record<string, MenuId> = Object.fromEntries(
    Object.entries(l.menus).filter(([k]) => k !== id),
  );
  if (to === "bar") {
    const at = index ?? bar.indexOf(BAR_SPACER);
    bar.splice(Math.max(0, Math.min(bar.length, at < 0 ? bar.length : at)), 0, id);
  } else if (to !== "hidden") menus[id] = to;
  return cleanLayout({ bar, menus }) ?? l;
}

/**
 * A divider after the item at `index`. Null where it would not stay: nothing picked,
 * next to another divider or the space, or at either end.
 */
export function withDivider(l: TopBarLayout, index: number): TopBarLayout | null {
  if (index < 0 || index >= l.bar.length) return null;
  const bar = [...l.bar];
  bar.splice(index + 1, 0, QUICK_DIVIDER);
  const clean = cleanLayout({ bar, menus: l.menus });
  return clean && clean.bar.length > l.bar.length ? clean : null;
}

/** The firm layout file's optional top bar (B8 adds it next to the old quickToolbar). */
export function parseFirmTopBar(text: string): TopBarLayout | null {
  try {
    const j = JSON.parse(text) as { topBar?: unknown };
    return cleanLayout(j.topBar);
  } catch {
    return null;
  }
}
