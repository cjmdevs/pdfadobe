// The app's menu commands (B8): one list that the menu bar, the command search (Alt+Q)
// and the top bar customization all read. Pure data, no DOM: what each command does is
// in src/ui/menus/useAppCommands.tsx. Shortcut keys come from shortcuts.ts.
import { SHORTCUTS, type Command } from "./shortcuts";

export type MenuId = "file" | "edit" | "view" | "window" | "help";

export const MENUS: { id: MenuId; label: string; mnemonic: string }[] = [
  { id: "file", label: "File", mnemonic: "f" },
  { id: "edit", label: "Edit", mnemonic: "e" },
  { id: "view", label: "View", mnemonic: "v" },
  { id: "window", label: "Window", mnemonic: "w" },
  { id: "help", label: "Help", mnemonic: "h" },
];

export interface AppCommandDef {
  id: string;
  label: string;
  menu: MenuId;
  /** Submenu label inside the menu ("Zoom"), or none. */
  sub?: string;
  /** Keyboard shortcut, from the shortcuts table. */
  shortcut?: Command;
  /** A checkable item (on/off or one of a group). */
  check?: boolean;
  /** Divider before this item. */
  divider?: boolean;
  /** Extra words the command search matches. */
  keywords?: string;
}

/** Placeholder rows for the menus' dynamic parts (recent files, tabs, help pages). */
export type DynamicMenu = "recent" | "tabs" | "helpTopics";

export type MenuRow = AppCommandDef | { dynamic: DynamicMenu; menu: MenuId; label?: string };

const c = (d: AppCommandDef): AppCommandDef => d;

export const MENU_ROWS: MenuRow[] = [
  // File
  c({ id: "file.open", label: "Open…", menu: "file", shortcut: "open" }),
  { dynamic: "recent", menu: "file", label: "Open recent" },
  c({ id: "file.home", label: "Home", menu: "file", keywords: "start screen recent" }),
  c({
    id: "file.createPdf",
    label: "Create PDF…",
    menu: "file",
    divider: true,
    keywords: "word excel convert",
  }),
  c({ id: "file.combine", label: "Combine Files…", menu: "file", keywords: "merge" }),
  c({ id: "file.save", label: "Save", menu: "file", shortcut: "save", divider: true }),
  c({ id: "file.saveAs", label: "Save As…", menu: "file", shortcut: "saveAs" }),
  c({
    id: "file.export",
    label: "Export PDF…",
    menu: "file",
    keywords: "png jpeg text word excel",
  }),
  c({ id: "file.print", label: "Print…", menu: "file", shortcut: "print", divider: true }),
  c({
    id: "file.properties",
    label: "Document properties…",
    menu: "file",
    shortcut: "properties",
    keywords: "info metadata",
  }),
  c({ id: "file.close", label: "Close", menu: "file", shortcut: "close", divider: true }),
  c({ id: "file.closeAll", label: "Close all", menu: "file", shortcut: "closeAll" }),
  c({ id: "file.quit", label: "Exit", menu: "file", shortcut: "quit", keywords: "quit" }),
  // Edit
  c({ id: "edit.undo", label: "Undo", menu: "edit", shortcut: "undo" }),
  c({ id: "edit.redo", label: "Redo", menu: "edit", shortcut: "redo" }),
  c({ id: "edit.cut", label: "Cut", menu: "edit", divider: true, keywords: "pages" }),
  c({ id: "edit.copy", label: "Copy", menu: "edit", shortcut: "copy", keywords: "pages text" }),
  c({ id: "edit.paste", label: "Paste", menu: "edit", keywords: "pages" }),
  c({ id: "edit.delete", label: "Delete", menu: "edit", shortcut: "deleteAnnotation" }),
  c({ id: "edit.selectAll", label: "Select all", menu: "edit", shortcut: "selectAll" }),
  c({
    id: "edit.find",
    label: "Find…",
    menu: "edit",
    shortcut: "find",
    divider: true,
    keywords: "search text",
  }),
  c({ id: "edit.findNext", label: "Find next", menu: "edit", shortcut: "findNext" }),
  c({ id: "edit.findPrev", label: "Find previous", menu: "edit", shortcut: "findPrev" }),
  c({
    id: "edit.commandSearch",
    label: "Search commands…",
    menu: "edit",
    shortcut: "commandSearch",
    divider: true,
    keywords: "find tool setting",
  }),
  c({
    id: "edit.preferences",
    label: "Preferences…",
    menu: "edit",
    shortcut: "preferences",
    keywords: "settings options",
  }),
  // View
  c({ id: "view.single", label: "Single page", menu: "view", sub: "Page display", check: true }),
  c({
    id: "view.continuous",
    label: "Single page continuous",
    menu: "view",
    sub: "Page display",
    check: true,
  }),
  c({
    id: "view.twoUp",
    label: "Two-up continuous",
    menu: "view",
    sub: "Page display",
    check: true,
    keywords: "spread",
  }),
  c({
    id: "view.cover",
    label: "Show cover page in two-up",
    menu: "view",
    sub: "Page display",
    check: true,
    divider: true,
  }),
  c({ id: "view.zoomIn", label: "Zoom in", menu: "view", sub: "Zoom", shortcut: "zoomIn" }),
  c({ id: "view.zoomOut", label: "Zoom out", menu: "view", sub: "Zoom", shortcut: "zoomOut" }),
  c({
    id: "view.fitPage",
    label: "Fit page",
    menu: "view",
    sub: "Zoom",
    shortcut: "fitPage",
    divider: true,
  }),
  c({
    id: "view.actualSize",
    label: "Actual size",
    menu: "view",
    sub: "Zoom",
    shortcut: "actualSize",
  }),
  c({ id: "view.fitWidth", label: "Fit width", menu: "view", sub: "Zoom", shortcut: "fitWidth" }),
  c({
    id: "view.first",
    label: "First page",
    menu: "view",
    sub: "Page navigation",
    shortcut: "firstPage",
  }),
  c({
    id: "view.prev",
    label: "Previous page",
    menu: "view",
    sub: "Page navigation",
    shortcut: "prevPage",
  }),
  c({
    id: "view.next",
    label: "Next page",
    menu: "view",
    sub: "Page navigation",
    shortcut: "nextPage",
  }),
  c({
    id: "view.last",
    label: "Last page",
    menu: "view",
    sub: "Page navigation",
    shortcut: "lastPage",
  }),
  c({
    id: "view.goTo",
    label: "Go to page…",
    menu: "view",
    sub: "Page navigation",
    shortcut: "goToPage",
  }),
  c({
    id: "view.prevView",
    label: "Previous view",
    menu: "view",
    sub: "Page navigation",
    shortcut: "prevView",
    divider: true,
    keywords: "back",
  }),
  c({
    id: "view.nextView",
    label: "Next view",
    menu: "view",
    sub: "Page navigation",
    shortcut: "nextView",
    keywords: "forward",
  }),
  c({
    id: "view.rotateCw",
    label: "Rotate view clockwise",
    menu: "view",
    sub: "Rotate view",
    shortcut: "rotateCw",
  }),
  c({
    id: "view.rotateCcw",
    label: "Rotate view counter-clockwise",
    menu: "view",
    sub: "Rotate view",
    shortcut: "rotateCcw",
  }),
  c({
    id: "view.hand",
    label: "Hand tool",
    menu: "view",
    check: true,
    keywords: "pan scroll space",
  }),
  c({
    id: "view.navPane",
    label: "Navigation pane",
    menu: "view",
    sub: "Show or hide",
    shortcut: "toggleNavPane",
    check: true,
    keywords: "thumbnails bookmarks sidebar",
  }),
  c({ id: "view.toolsPane", label: "Tools pane", menu: "view", sub: "Show or hide", check: true }),
  c({
    id: "view.comments",
    label: "Comments panel",
    menu: "view",
    sub: "Show or hide",
    check: true,
  }),
  c({
    id: "view.themeSystem",
    label: "Same as Windows",
    menu: "view",
    sub: "Theme",
    check: true,
    keywords: "dark light",
  }),
  c({ id: "view.themeLight", label: "Light", menu: "view", sub: "Theme", check: true }),
  c({ id: "view.themeDark", label: "Dark", menu: "view", sub: "Theme", check: true }),
  // Window
  c({ id: "window.nextTab", label: "Next tab", menu: "window", shortcut: "nextTab" }),
  c({ id: "window.prevTab", label: "Previous tab", menu: "window", shortcut: "prevTab" }),
  c({ id: "window.moveTab", label: "Move tab to new window", menu: "window" }),
  { dynamic: "tabs", menu: "window" },
  c({
    id: "window.calculator",
    label: "Calculator",
    menu: "window",
    check: true,
    divider: true,
    keywords: "tape adding machine",
  }),
  c({ id: "window.tickmarks", label: "Tickmark palette", menu: "window", check: true }),
  c({ id: "window.stamps", label: "Stamps palette", menu: "window", check: true }),
  c({
    id: "window.customize",
    label: "Customize top bar…",
    menu: "window",
    divider: true,
    keywords: "toolbar quick tools layout",
  }),
  c({ id: "window.resetTop", label: "Reset top bar", menu: "window", keywords: "toolbar default" }),
  // Help
  c({
    id: "help.topics",
    label: "Help topics",
    menu: "help",
    shortcut: "help",
    keywords: "how to guide",
  }),
  { dynamic: "helpTopics", menu: "help", label: "Help by feature" },
  c({ id: "help.shortcuts", label: "Keyboard shortcuts", menu: "help", keywords: "keys" }),
  c({ id: "help.updates", label: "Check for updates", menu: "help", divider: true }),
  c({
    id: "help.defaultApp",
    label: "Default PDF program…",
    menu: "help",
    keywords: "associate open with",
  }),
  c({ id: "help.crash", label: "Crash reports folder", menu: "help" }),
  c({ id: "help.notices", label: "Third-party notices", menu: "help", keywords: "licenses" }),
  c({
    id: "help.about",
    label: "About PDF Workbench",
    menu: "help",
    divider: true,
    keywords: "version",
  }),
];

export const APP_COMMANDS: AppCommandDef[] = MENU_ROWS.filter((r): r is AppCommandDef => "id" in r);

export function appCommand(id: string): AppCommandDef | undefined {
  return APP_COMMANDS.find((d) => d.id === id);
}

/** First key combo of a command ("Ctrl+O"), as written in shortcuts.ts. */
export function shortcutKey(cmd: Command | undefined): string | undefined {
  return cmd ? SHORTCUTS.find((s) => s.command === cmd)?.keys[0] : undefined;
}

/** Edit menu keys that act on whatever has focus (pages, text, comments). */
export const EDIT_KEYS: Record<string, string> = {
  "edit.cut": "Ctrl+X",
  "edit.copy": "Ctrl+C",
  "edit.paste": "Ctrl+V",
  "edit.delete": "Delete",
  "edit.selectAll": "Ctrl+A",
};
