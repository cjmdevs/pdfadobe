// Keyboard shortcuts matching Adobe Acrobat on Windows.
//
// Sources (checked 2026-10-21):
//   adobe     helpx.adobe.com/acrobat/desktop/get-started/preferences-and-settings/keyboard-shortcuts.html
//             (Adobe's published table, last updated 2025-09-23)
//   adobeView helpx.adobe.com/acrobat/using/adjusting-pdf-views.html (rotate view)
//   adobeHub  adobe.com/acrobat/hub/how-to-rotate-pdf-pc.html (rotate counter-clockwise)
//   community Adobe Community answers (Acrobat menu accelerators not in the published table)
//   windows   standard Windows accelerators Acrobat also uses
//   owner     menu accelerators not on Adobe's pages, checked by the owner in Acrobat
//             (2026-10-22). Ctrl+Y is Redo in Acrobat (bound in Phase 2 with undo).
//
// Key tokens match either KeyboardEvent.code (layout-independent: Equal, Minus, Digit0,
// NumpadAdd) or KeyboardEvent.key (letters, PageUp, F3...).

export type Command =
  | "open"
  | "close"
  | "closeAll"
  | "nextTab"
  | "prevTab"
  | "nextPage"
  | "prevPage"
  | "nextScreen"
  | "prevScreen"
  | "firstPage"
  | "lastPage"
  | "goToPage"
  | "zoomIn"
  | "zoomOut"
  | "fitPage"
  | "actualSize"
  | "fitWidth"
  | "rotateCw"
  | "rotateCcw"
  | "find"
  | "findNext"
  | "findPrev"
  | "print"
  | "properties"
  | "toggleNavPane"
  | "focusNavPane"
  | "selectAll"
  | "copy"
  | "escape"
  | "help"
  | "undo"
  | "redo"
  | "save"
  | "saveAs"
  | "quit";

export type Source = "adobe" | "adobeView" | "adobeHub" | "community" | "windows" | "owner";

export interface Shortcut {
  command: Command;
  label: string;
  keys: string[];
  source: Source;
}

export const SHORTCUTS: Shortcut[] = [
  { command: "open", label: "Open", keys: ["Ctrl+O"], source: "windows" },
  // Acrobat's File > Exit Application shows Ctrl+Q (not in Adobe's published table).
  { command: "quit", label: "Exit (all windows)", keys: ["Ctrl+Q"], source: "community" },
  { command: "close", label: "Close document", keys: ["Ctrl+W", "Ctrl+F4"], source: "adobe" },
  {
    command: "closeAll",
    label: "Close all documents",
    keys: ["Ctrl+Shift+W"],
    source: "owner",
  },
  {
    command: "nextTab",
    label: "Next document tab",
    keys: ["Ctrl+Tab", "Ctrl+F6"],
    source: "adobe",
  },
  {
    command: "prevTab",
    label: "Previous document tab",
    keys: ["Ctrl+Shift+Tab", "Ctrl+Shift+F6"],
    source: "adobe",
  },
  {
    command: "nextPage",
    label: "Next page",
    keys: ["ArrowRight", "Ctrl+PageDown"],
    source: "adobe",
  },
  {
    command: "prevPage",
    label: "Previous page",
    keys: ["ArrowLeft", "Ctrl+PageUp"],
    source: "adobe",
  },
  { command: "nextScreen", label: "Next screen", keys: ["PageDown", "Enter"], source: "adobe" },
  {
    command: "prevScreen",
    label: "Previous screen",
    keys: ["PageUp", "Shift+Enter"],
    source: "adobe",
  },
  {
    command: "firstPage",
    label: "First page",
    keys: ["Home", "Ctrl+Shift+PageUp", "Ctrl+Shift+ArrowUp"],
    source: "adobe",
  },
  {
    command: "lastPage",
    label: "Last page",
    keys: ["End", "Ctrl+Shift+PageDown", "Ctrl+Shift+ArrowDown"],
    source: "adobe",
  },
  { command: "goToPage", label: "Go to page", keys: ["Ctrl+Shift+N"], source: "adobe" },
  { command: "zoomIn", label: "Zoom in", keys: ["Ctrl+Equal", "Ctrl+NumpadAdd"], source: "adobe" },
  {
    command: "zoomOut",
    label: "Zoom out",
    keys: ["Ctrl+Minus", "Ctrl+NumpadSubtract"],
    source: "adobe",
  },
  {
    command: "fitPage",
    label: "Zoom to page level (fit page)",
    keys: ["Ctrl+Digit0", "Ctrl+Numpad0"],
    source: "community",
  },
  {
    command: "actualSize",
    label: "Actual size",
    keys: ["Ctrl+Digit1", "Ctrl+Numpad1"],
    source: "community",
  },
  {
    command: "fitWidth",
    label: "Fit width",
    keys: ["Ctrl+Digit2", "Ctrl+Numpad2"],
    source: "community",
  },
  {
    command: "rotateCw",
    label: "Rotate view clockwise",
    keys: ["Ctrl+Shift+Equal", "Ctrl+Shift+NumpadAdd"],
    source: "adobeView",
  },
  {
    command: "rotateCcw",
    label: "Rotate view counter-clockwise",
    keys: ["Ctrl+Shift+Minus", "Ctrl+Shift+NumpadSubtract"],
    source: "adobeHub",
  },
  { command: "find", label: "Find", keys: ["Ctrl+F", "Ctrl+Shift+F"], source: "adobe" },
  { command: "findNext", label: "Next search result", keys: ["F3", "Ctrl+G"], source: "adobe" },
  {
    command: "findPrev",
    label: "Previous search result",
    keys: ["Shift+F3"],
    source: "owner",
  },
  { command: "print", label: "Print", keys: ["Ctrl+P"], source: "windows" },
  { command: "properties", label: "Document properties", keys: ["Ctrl+D"], source: "owner" },
  {
    command: "toggleNavPane",
    label: "Show/hide navigation pane",
    keys: ["F4"],
    source: "owner",
  },
  {
    command: "focusNavPane",
    label: "Open and focus navigation pane",
    keys: ["Ctrl+Shift+F5"],
    source: "adobe",
  },
  { command: "selectAll", label: "Select all text", keys: ["Ctrl+A"], source: "windows" },
  { command: "copy", label: "Copy selected text", keys: ["Ctrl+C"], source: "windows" },
  { command: "escape", label: "Close search / dialog", keys: ["Escape"], source: "adobe" },
  { command: "help", label: "Keyboard shortcuts", keys: ["F1"], source: "adobe" },
  { command: "undo", label: "Undo page change", keys: ["Ctrl+Z"], source: "windows" },
  { command: "redo", label: "Redo page change", keys: ["Ctrl+Y"], source: "owner" },
  { command: "save", label: "Save", keys: ["Ctrl+S"], source: "windows" },
  { command: "saveAs", label: "Save As", keys: ["Ctrl+Shift+S"], source: "windows" },
];

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

interface Combo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  token: string;
}

function parse(combo: string): Combo {
  const parts = combo.split("+");
  const token = parts.pop() ?? "";
  return {
    ctrl: parts.includes("Ctrl"),
    shift: parts.includes("Shift"),
    alt: parts.includes("Alt"),
    token: token.toLowerCase(),
  };
}

const TABLE: { combo: Combo; command: Command }[] = SHORTCUTS.flatMap((s) =>
  s.keys.map((k) => ({ combo: parse(k), command: s.command })),
);

/** Keys an <input> or <textarea> needs for itself; never steal them while typing. */
const TEXT_EDITING = new Set([
  "a",
  "c",
  "v",
  "x",
  "z",
  "y",
  "arrowleft",
  "arrowright",
  "home",
  "end",
]);

export function matchShortcut(e: KeyLike, inEditable: boolean): Command | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const code = e.code.toLowerCase();
  for (const { combo, command } of TABLE) {
    if (combo.ctrl !== ctrl || combo.shift !== e.shiftKey || combo.alt !== e.altKey) continue;
    if (combo.token !== key && combo.token !== code) continue;
    if (inEditable) {
      const plain =
        !combo.ctrl && !combo.alt && !/^f\d+$/.test(combo.token) && combo.token !== "escape";
      if (plain || TEXT_EDITING.has(combo.token)) return null;
    }
    return command;
  }
  return null;
}

/** "Ctrl+Equal" -> "Ctrl+=" for display. */
export function displayKey(combo: string): string {
  return combo
    .replace("Equal", "=")
    .replace("NumpadAdd", "Num +")
    .replace("NumpadSubtract", "Num -")
    .replace("Minus", "-")
    .replace(/Digit(\d)/, "$1")
    .replace(/Numpad(\d)/, "Num $1")
    .replace("ArrowUp", "Up")
    .replace("ArrowDown", "Down")
    .replace("ArrowLeft", "Left")
    .replace("ArrowRight", "Right");
}
