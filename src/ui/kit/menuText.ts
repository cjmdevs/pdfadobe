// Pure helpers for kit menus and tooltips (B8); no DOM, so Node tests can use them.

export interface MenuItemEntry {
  kind?: "item";
  id: string;
  label: string;
  /** Shown on the right ("Ctrl+C"); a key combo as written in shortcuts.ts. */
  shortcut?: string | undefined;
  disabled?: boolean | undefined;
  /** A checkable item: true/false shows the check box state. */
  checked?: boolean | undefined;
  danger?: boolean | undefined;
  run: () => void;
}
export interface SubmenuEntry {
  kind: "submenu";
  id: string;
  label: string;
  items: MenuEntry[];
  disabled?: boolean | undefined;
}
export interface DividerEntry {
  kind: "divider";
}
export type MenuEntry = MenuItemEntry | SubmenuEntry | DividerEntry;

/** Drops leading, trailing and doubled dividers (after hidden items were removed). */
export function tidy(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const it of items) {
    if (it.kind === "divider" && (!out.length || out.at(-1)?.kind === "divider")) continue;
    out.push(it);
  }
  if (out.at(-1)?.kind === "divider") out.pop();
  return out;
}

const KEYISH =
  /^(?:.*\b(?:Ctrl|Shift|Alt)\+.*|F\d{1,2}|Del(?:ete)?|Home|End|Esc(?:ape)?|Enter|Space|Tab|Page ?Up|Page ?Down|(?:Left|Right|Up|Down)(?: arrow)?|[A-Z0-9])$/i;

/** "Open (Ctrl+O)" -> { label: "Open", keys: "Ctrl+O" }. Only key-like brackets split. */
export function splitTip(text: string): { label: string; keys: string | null } {
  const m = /^(.*\S)\s*\(([^()]+)\)\s*$/.exec(text);
  if (m?.[1] && m[2] && KEYISH.test(m[2].trim())) return { label: m[1], keys: m[2].trim() };
  return { label: text, keys: null };
}
