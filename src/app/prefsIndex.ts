// Preferences (B8): categories and every setting's label, in one list the Preferences
// dialog and the command search (Alt+Q) share. Pure data, no DOM.

export type PrefCategory =
  | "general"
  | "pageDisplay"
  | "commenting"
  | "editPdf"
  | "fonts"
  | "pdflyer"
  | "security"
  | "updates";

export const PREF_CATEGORIES: { id: PrefCategory; label: string }[] = [
  { id: "general", label: "General" },
  { id: "pageDisplay", label: "Page Display" },
  { id: "commenting", label: "Commenting" },
  { id: "editPdf", label: "Edit PDF" },
  { id: "fonts", label: "Fonts" },
  { id: "pdflyer", label: "PDFlyer" },
  { id: "security", label: "Security" },
  { id: "updates", label: "Updates" },
];

export interface PrefDef {
  id: string;
  category: PrefCategory;
  label: string;
  keywords?: string;
}

export const PREFS: PrefDef[] = [
  // General
  { id: "theme", category: "general", label: "Theme", keywords: "dark light colour" },
  { id: "restoreSession", category: "general", label: "Reopen last session’s files at start" },
  { id: "recentThumbnails", category: "general", label: "Show page thumbnails in recent files" },
  { id: "toolsPaneOpen", category: "general", label: "Show the Tools pane" },
  {
    id: "firmLibraryPath",
    category: "general",
    label: "Firm library folder",
    keywords: "share network",
  },
  {
    id: "defaultApp",
    category: "general",
    label: "Default PDF program",
    keywords: "open with associate",
  },
  // Page Display
  {
    id: "viewMode",
    category: "pageDisplay",
    label: "Page display",
    keywords: "single continuous two-up",
  },
  {
    id: "zoom",
    category: "pageDisplay",
    label: "Zoom for new documents",
    keywords: "fit width page",
  },
  { id: "coverPage", category: "pageDisplay", label: "Show cover page in two-up" },
  {
    id: "units",
    category: "pageDisplay",
    label: "Units",
    keywords: "inches millimetres points measure",
  },
  { id: "formHighlight", category: "pageDisplay", label: "Highlight form fields" },
  {
    id: "bookmarkDragMovesPages",
    category: "pageDisplay",
    label: "Dragging a bookmark moves its pages",
  },
  // Commenting
  {
    id: "authorName",
    category: "commenting",
    label: "Author name for comments",
    keywords: "name signed",
  },
  { id: "userInitials", category: "commenting", label: "Initials on stamps" },
  { id: "markupColors", category: "commenting", label: "Colour swatches" },
  {
    id: "markupDefaults",
    category: "commenting",
    label: "Markup styles saved with Make default",
    keywords: "reset",
  },
  // Edit PDF
  {
    id: "snapToGuides",
    category: "editPdf",
    label: "Snap to page edges and nearby objects",
    keywords: "guides align alt",
  },
  { id: "snapDistance", category: "editPdf", label: "Snap distance" },
  {
    id: "showBoxReadout",
    category: "editPdf",
    label: "Show position and size while dragging",
    keywords: "x y width height readout",
  },
  // Fonts
  { id: "firmFontsPath", category: "fonts", label: "Firm font folder" },
  { id: "fontSources", category: "fonts", label: "Where fonts come from" },
  // PDFlyer
  {
    id: "firmTickmarksPath",
    category: "pdflyer",
    label: "Firm tickmark file",
    keywords: "workpaper settings",
  },
  { id: "tickmarkLibrary", category: "pdflyer", label: "Tickmark library", keywords: "tickmarks" },
  {
    id: "calcMode",
    category: "pdflyer",
    label: "Calculator keypad",
    keywords: "10-key ten key adding machine",
  },
  { id: "calcDecimals", category: "pdflyer", label: "Calculator decimals" },
  { id: "calcAddMode", category: "pdflyer", label: "Add mode (two implied decimals)" },
  { id: "calcTapeColor", category: "pdflyer", label: "Calculator tape colour" },
  {
    id: "showStampNames",
    category: "pdflyer",
    label: "Stamp menus list names instead of pictures",
  },
  {
    id: "recentTickmarks",
    category: "pdflyer",
    label: "Recently used tickmarks",
    keywords: "clear",
  },
  // Security
  { id: "signWithDate", category: "security", label: "Put the date under a placed signature" },
  {
    id: "claudeAccess",
    category: "security",
    label: "Claude access to document text (MCP)",
    keywords: "ai policy",
  },
  {
    id: "clearRecent",
    category: "security",
    label: "Clear recent files and thumbnails",
    keywords: "privacy history",
  },
  // Updates
  { id: "checkUpdates", category: "updates", label: "Check for updates" },
  { id: "lastUpdateCheck", category: "updates", label: "Last check" },
];

export function prefDef(id: string): PrefDef | undefined {
  return PREFS.find((p) => p.id === id);
}
