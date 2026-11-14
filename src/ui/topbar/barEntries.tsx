// Top bar items as menu entries (B8): for the overflow menu when the window is narrow,
// and for items the user moved into a menu of the menu bar.
import { appCommand, shortcutKey } from "../../app/appCommands";
import { BAR_SPACER } from "../../app/topBar";
import {
  QUICK_DIVIDER,
  actionEnabled,
  menuItems,
  resolveAction,
  type MenuItem,
  type ToolContext,
} from "../../tools/registry";
import type { MenuEntry, MenuItemEntry } from "../kit/Menu";
import { useAppCommands } from "../menus/useAppCommands";

/** Built-in items that are one menu command, or a submenu of several. */
const AS_COMMAND: Record<string, string | { label: string; ids: string[] }> = {
  "bar:open": "file.open",
  "bar:save": "file.save",
  "bar:print": "file.print",
  "bar:find": "edit.find",
  "bar:undo": "edit.undo",
  "bar:redo": "edit.redo",
  "bar:pageNav": {
    label: "Page navigation",
    ids: ["view.first", "view.prev", "view.next", "view.last", "view.goTo"],
  },
  "bar:zoom": {
    label: "Zoom",
    ids: ["view.zoomIn", "view.zoomOut", "view.fitPage", "view.actualSize", "view.fitWidth"],
  },
  "bar:hand": "view.hand",
  "bar:search": "edit.commandSearch",
  "bar:viewMode": {
    label: "Page display",
    ids: ["view.single", "view.continuous", "view.twoUp", "view.cover"],
  },
  "bar:properties": "file.properties",
  "bar:help": "help.topics",
  "bar:theme": { label: "Theme", ids: ["view.themeSystem", "view.themeLight", "view.themeDark"] },
  "bar:preferences": "edit.preferences",
  "bar:customize": "window.customize",
  "bar:toolsPane": "view.toolsPane",
};

/** The menu commands a built-in item stands for (none for tool actions). */
export function commandsOf(id: string): string[] {
  const c = AS_COMMAND[id];
  return c === undefined ? [] : typeof c === "string" ? [c] : c.ids;
}

function toolItems(items: MenuItem[], ctx: ToolContext, prefix: string): MenuEntry[] {
  return items.flatMap((it): MenuEntry[] => {
    const entry: MenuEntry = it.items
      ? {
          kind: "submenu",
          id: `${prefix}.${it.id}`,
          label: it.label,
          items: toolItems(it.items, ctx, `${prefix}.${it.id}`),
          disabled: it.disabled,
        }
      : {
          id: `${prefix}.${it.id}`,
          label: it.label,
          disabled: it.disabled,
          checked: it.check || it.checked ? !!it.checked : undefined,
          run: () => it.run(ctx),
        };
    return it.separator ? [{ kind: "divider" }, entry] : [entry];
  });
}

export function useBarEntries(ctx: ToolContext) {
  const cmds = useAppCommands();
  const cmdEntry = (id: string): MenuItemEntry => {
    const d = appCommand(id);
    const s = cmds.state(id);
    return {
      id,
      label: d?.label ?? id,
      shortcut: shortcutKey(d?.shortcut),
      disabled: !s.enabled,
      checked: d?.check ? !!s.checked : undefined,
      run: () => cmds.run(id),
    };
  };
  return (ids: string[]): MenuEntry[] =>
    ids.flatMap((id): MenuEntry[] => {
      if (id === QUICK_DIVIDER) return [{ kind: "divider" }];
      if (id === BAR_SPACER) return [];
      const c = AS_COMMAND[id];
      if (typeof c === "string") return [cmdEntry(c)];
      if (c !== undefined)
        return [{ kind: "submenu", id, label: c.label, items: c.ids.map(cmdEntry) }];
      const hit = resolveAction(id);
      if (!hit || (hit.action.shown && !hit.action.shown())) return [];
      const { tool, action } = hit;
      if (action.items)
        return [
          {
            kind: "submenu",
            id,
            label: action.label,
            disabled: !actionEnabled(tool, action, ctx),
            items: action.menuOnly
              ? toolItems(menuItems(action, ctx), ctx, id)
              : [
                  { id: `${id}.run`, label: action.label, run: () => action.run(ctx) },
                  { kind: "divider" },
                  ...toolItems(menuItems(action, ctx), ctx, id),
                ],
          },
        ];
      return [
        {
          id,
          label: action.label,
          disabled: !actionEnabled(tool, action, ctx),
          run: () => action.run(ctx),
        },
      ];
    });
}
