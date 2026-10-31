// Persisted app settings. Stored by the platform (Rust JSON file / localStorage).
// No DOM or React here so it can be unit-tested in Node.

import type { Scaling } from "../platform/types";
import type { TickmarkDef } from "../engine/flyer/tickmarks";
import type { StampTemplate } from "../engine/flyer/userStamps";
import { sanitizeStampTemplates, sanitizeTickmarks } from "../flyer/library";
import { DEFAULT_CALC, sanitizeCalc, type CalcSettings } from "../flyer/calc";
import { sanitizePresets, type HeaderFooterPreset } from "../engine/decorate";

export type Theme = "system" | "light" | "dark";
export type ViewMode = "continuous" | "single" | "twoUp";
export type SidebarTab = "thumbnails" | "outline" | "attachments";
/** EmbedPDF zoom: a fit mode or a PDFium scale factor (1 = 72 dpi). */
export type ZoomSetting = "fit-page" | "fit-width" | number;

export interface Settings {
  version: 1;
  theme: Theme;
  zoom: ZoomSetting;
  viewMode: ViewMode;
  /** Two-up: show page 1 alone (Acrobat "Show Cover Page in Two Page View"). */
  coverPage: boolean;
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  /** Most recent first. Paths only; files opened from memory are never remembered. */
  recent: string[];
  /** Paths of tabs open at exit, restored at next start. */
  openTabs: string[];
  activeTab: string | null;
  printScaling: Scaling;
  printAutoRotate: boolean;
  /** Bookmark panel: dragging a bookmark also moves its pages (and child bookmarks). */
  bookmarkDragMovesPages: boolean;
  /** Right-hand Tools pane shown. */
  toolsPaneOpen: boolean;
  /** Show tools that are not built yet, greyed out ("Coming in Phase N"). */
  showComingTools: boolean;
  /** The user's own quick toolbar ("tool.action" refs); null = the firm default. */
  quickToolbar: string[] | null;
  /** Firm default layout file on the network share (JSON), or null. */
  firmLayoutPath: string | null;
  /** Last firm layout read from that file, used when the share is unreachable. */
  firmLayoutCache: string[] | null;
  /** Firm font folder on the network share (Edit PDF), or null. Mirrored locally. */
  firmFontsPath: string | null;
  /** Comments panel shown (right side, Phase 3). */
  commentsOpen: boolean;
  /** Markup author; null = the Windows user's display name. */
  authorName: string | null;
  /** Color swatches offered by the markup tools ("#rrggbb"). */
  markupColors: string[];
  /** "Make default" per markup tool: style properties only (color, width, font...). */
  markupDefaults: Record<string, Record<string, string | number | boolean>>;
  /** The user's own tickmarks (Phase 4). */
  tickmarks: TickmarkDef[];
  /** Firm tickmark file on the network share (workpaper settings JSON), or null. */
  firmTickmarksPath: string | null;
  /** Last firm tickmarks read from that file, used when the share is unreachable. */
  firmTickmarksCache: TickmarkDef[] | null;
  /** Tickmark ids, most recent first. */
  recentTickmarks: string[];
  /** The tickmark the active-tickmark button places ("footed", or "letter:A"). */
  activeTickmark: string;
  /** Each toolbar section's last pick (section id -> "letter:A"). */
  sectionLast: Record<string, string>;
  /** Floating tickmark palette shown. */
  tickmarkPaletteOpen: boolean;
  /** The user's own stamp templates (Phase 4 stage 2). */
  stampTemplates: StampTemplate[];
  /** Firm stamp templates from the firm file (firmTickmarksPath), last copy. */
  firmStampsCache: StampTemplate[] | null;
  /** Initials on user and status stamps; null = from the author name. */
  userInitials: string | null;
  /** Last connector style used. */
  connectorStyle: string;
  /** Calculator (Phase 4 stage 3). */
  calc: CalcSettings;
  /** Floating calculator shown. */
  calcOpen: boolean;
  /** Fill Forms (Phase 6): tint fillable fields, outline required ones (Acrobat's default). */
  formHighlight: boolean;
  /** Stamp tool (B6): favourite stamps ("b:approved" built-in, "c:<id>" custom). */
  stampFavorites: string[];
  /** The stamp placed last (top of the Stamp menu), or null. */
  lastStamp: string | null;
  /** Stamp menus list names instead of pictures. */
  showStampNames: boolean;
  /** Floating Stamps Palette shown. */
  stampsPaletteOpen: boolean;
  /** Fill & Sign: put the date under a placed signature (Phase 8). */
  signWithDate: boolean;
  /** Thumbprint of the store certificate last signed with (Phase 8). */
  lastSigningCert: string | null;
  /** Custom stamps' category and (renamed) name, by custom stamp id. */
  customStampInfo: Record<string, { category: string; name?: string }>;
  /** Saved Header & Footer and Bates setups (Phase 7). */
  headerFooterPresets: HeaderFooterPreset[];
}

export const MAX_RECENT = 15;

/** Settings that belong to one window (backlog B1): extra windows never save them, so
 * they cannot overwrite the main window's view or its list of tabs to reopen. */
export const WINDOW_LOCAL_SETTINGS: readonly (keyof Settings)[] = [
  "zoom",
  "viewMode",
  "coverPage",
  "sidebarOpen",
  "sidebarTab",
  "toolsPaneOpen",
  "commentsOpen",
  "openTabs",
  "activeTab",
];

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: "system",
  zoom: "fit-width",
  viewMode: "continuous",
  coverPage: false,
  sidebarOpen: true,
  sidebarTab: "thumbnails",
  recent: [],
  openTabs: [],
  activeTab: null,
  printScaling: "shrinkOversized",
  printAutoRotate: true,
  bookmarkDragMovesPages: true,
  toolsPaneOpen: true,
  showComingTools: false,
  quickToolbar: null,
  firmLayoutPath: null,
  firmLayoutCache: null,
  firmFontsPath: null,
  commentsOpen: false,
  authorName: null,
  markupColors: [
    "#FFFF00",
    "#00FF00",
    "#00FFFF",
    "#FF00FF",
    "#FF0000",
    "#0000FF",
    "#000000",
    "#FFFFFF",
  ],
  markupDefaults: {},
  tickmarks: [],
  firmTickmarksPath: null,
  firmTickmarksCache: null,
  recentTickmarks: [],
  activeTickmark: "agrees",
  sectionLast: {},
  tickmarkPaletteOpen: false,
  stampTemplates: [],
  firmStampsCache: null,
  userInitials: null,
  connectorStyle: "arrow",
  calc: DEFAULT_CALC,
  calcOpen: false,
  formHighlight: true,
  stampFavorites: [],
  lastStamp: null,
  showStampNames: false,
  stampsPaletteOpen: false,
  signWithDate: false,
  lastSigningCert: null,
  customStampInfo: {},
  headerFooterPresets: [],
};

const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (values as string[]).includes(v);

const isTheme = oneOf<Theme>("system", "light", "dark");
const isViewMode = oneOf<ViewMode>("continuous", "single", "twoUp");
const isTab = oneOf<SidebarTab>("thumbnails", "outline", "attachments");
const isScaling = oneOf<Scaling>("fit", "shrinkOversized", "actualSize");

function isZoom(v: unknown): v is ZoomSetting {
  return v === "fit-page" || v === "fit-width" || (typeof v === "number" && v >= 0.05 && v <= 64);
}

function paths(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return dedupePaths(v.filter((p): p is string => typeof p === "string" && p.length > 0)).slice(
    0,
    max,
  );
}

/** Accept whatever was on disk; anything missing or wrong falls back to the default. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const openTabs = paths(r.openTabs, 50);
  const activeTab =
    typeof r.activeTab === "string" && openTabs.includes(r.activeTab) ? r.activeTab : null;
  return {
    version: 1,
    theme: isTheme(r.theme) ? r.theme : d.theme,
    zoom: isZoom(r.zoom) ? r.zoom : d.zoom,
    viewMode: isViewMode(r.viewMode) ? r.viewMode : d.viewMode,
    coverPage: typeof r.coverPage === "boolean" ? r.coverPage : d.coverPage,
    sidebarOpen: typeof r.sidebarOpen === "boolean" ? r.sidebarOpen : d.sidebarOpen,
    sidebarTab: isTab(r.sidebarTab) ? r.sidebarTab : d.sidebarTab,
    recent: paths(r.recent, MAX_RECENT),
    openTabs,
    activeTab,
    printScaling: isScaling(r.printScaling) ? r.printScaling : d.printScaling,
    printAutoRotate: typeof r.printAutoRotate === "boolean" ? r.printAutoRotate : d.printAutoRotate,
    bookmarkDragMovesPages:
      typeof r.bookmarkDragMovesPages === "boolean"
        ? r.bookmarkDragMovesPages
        : d.bookmarkDragMovesPages,
    toolsPaneOpen: typeof r.toolsPaneOpen === "boolean" ? r.toolsPaneOpen : d.toolsPaneOpen,
    showComingTools: typeof r.showComingTools === "boolean" ? r.showComingTools : d.showComingTools,
    quickToolbar: stringList(r.quickToolbar),
    firmLayoutPath:
      typeof r.firmLayoutPath === "string" && r.firmLayoutPath.trim() ? r.firmLayoutPath : null,
    firmLayoutCache: stringList(r.firmLayoutCache),
    firmFontsPath:
      typeof r.firmFontsPath === "string" && r.firmFontsPath.trim() ? r.firmFontsPath : null,
    commentsOpen: typeof r.commentsOpen === "boolean" ? r.commentsOpen : d.commentsOpen,
    authorName:
      typeof r.authorName === "string" && r.authorName.trim()
        ? r.authorName.trim().slice(0, 100)
        : null,
    markupColors: colorList(r.markupColors) ?? d.markupColors,
    markupDefaults: toolDefaults(r.markupDefaults),
    tickmarks: sanitizeTickmarks(r.tickmarks),
    firmTickmarksPath:
      typeof r.firmTickmarksPath === "string" && r.firmTickmarksPath.trim()
        ? r.firmTickmarksPath
        : null,
    firmTickmarksCache: Array.isArray(r.firmTickmarksCache)
      ? sanitizeTickmarks(r.firmTickmarksCache)
      : null,
    recentTickmarks: (stringList(r.recentTickmarks) ?? []).slice(0, 8),
    activeTickmark:
      typeof r.activeTickmark === "string" && r.activeTickmark
        ? r.activeTickmark.slice(0, 80)
        : d.activeTickmark,
    tickmarkPaletteOpen:
      typeof r.tickmarkPaletteOpen === "boolean" ? r.tickmarkPaletteOpen : d.tickmarkPaletteOpen,
    sectionLast: sectionLast(r.sectionLast),
    stampTemplates: sanitizeStampTemplates(r.stampTemplates),
    firmStampsCache: Array.isArray(r.firmStampsCache)
      ? sanitizeStampTemplates(r.firmStampsCache)
      : null,
    userInitials:
      typeof r.userInitials === "string" && r.userInitials.trim()
        ? r.userInitials.trim().slice(0, 6)
        : null,
    connectorStyle:
      typeof r.connectorStyle === "string" && /^\w{1,20}$/.test(r.connectorStyle)
        ? r.connectorStyle
        : d.connectorStyle,
    calc: sanitizeCalc(r.calc),
    calcOpen: typeof r.calcOpen === "boolean" ? r.calcOpen : d.calcOpen,
    formHighlight: typeof r.formHighlight === "boolean" ? r.formHighlight : d.formHighlight,
    stampFavorites: Array.isArray(r.stampFavorites)
      ? r.stampFavorites.filter(isStampRef).slice(0, 50)
      : d.stampFavorites,
    lastStamp: isStampRef(r.lastStamp) ? r.lastStamp : d.lastStamp,
    showStampNames: typeof r.showStampNames === "boolean" ? r.showStampNames : d.showStampNames,
    stampsPaletteOpen:
      typeof r.stampsPaletteOpen === "boolean" ? r.stampsPaletteOpen : d.stampsPaletteOpen,
    signWithDate: typeof r.signWithDate === "boolean" ? r.signWithDate : d.signWithDate,
    lastSigningCert:
      typeof r.lastSigningCert === "string" && /^[0-9A-F]{40}$/.test(r.lastSigningCert)
        ? r.lastSigningCert
        : d.lastSigningCert,
    customStampInfo: stampInfo(r.customStampInfo),
    headerFooterPresets: sanitizePresets(r.headerFooterPresets),
  };
}

const isStampRef = (v: unknown): v is string =>
  typeof v === "string" && /^[bc]:[A-Za-z0-9._-]{1,80}$/.test(v);

const shortText = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= 80;

function stampInfo(v: unknown): Settings["customStampInfo"] {
  if (!v || typeof v !== "object") return {};
  const out: Settings["customStampInfo"] = {};
  for (const [id, info] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id) || !info || typeof info !== "object") continue;
    const { category, name } = info as Record<string, unknown>;
    if (!shortText(category)) continue;
    out[id] = { category: category.trim(), ...(shortText(name) ? { name: name.trim() } : {}) };
  }
  return out;
}

const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function colorList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const list = v.filter(isColor).slice(0, 24);
  return list.length ? list : null;
}

/** Tool id -> { property: plain value }. Anything else on disk is dropped. */
function toolDefaults(v: unknown): Settings["markupDefaults"] {
  if (!v || typeof v !== "object") return {};
  const out: Settings["markupDefaults"] = {};
  for (const [tool, patch] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[A-Za-z]{1,40}$/.test(tool) || !patch || typeof patch !== "object") continue;
    const clean: Record<string, string | number | boolean> = {};
    for (const [k, val] of Object.entries(patch as Record<string, unknown>)) {
      if (!/^[A-Za-z]{1,40}$/.test(k)) continue;
      if (typeof val === "string" ? val.length <= 40 : ["number", "boolean"].includes(typeof val))
        clean[k] = val as string | number | boolean;
    }
    out[tool] = clean;
  }
  return out;
}

/** Section id -> last pick; anything odd on disk is dropped. */
function sectionLast(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>))
    if (/^[a-z]{1,20}$/.test(k) && typeof val === "string" && val.length <= 100) out[k] = val;
  return out;
}

/** A list of strings (tool action refs), or null. Unknown refs are dropped later. */
function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string").slice(0, 100);
}

/** Windows paths are case-insensitive and accept either slash. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\//g, "\\").toLowerCase();
  return norm(a) === norm(b);
}

function dedupePaths(list: string[]): string[] {
  const out: string[] = [];
  for (const p of list) if (!out.some((q) => samePath(p, q))) out.push(p);
  return out;
}

export function addRecent(recent: string[], path: string): string[] {
  return [path, ...recent.filter((p) => !samePath(p, path))].slice(0, MAX_RECENT);
}

export function removeRecent(recent: string[], path: string): string[] {
  return recent.filter((p) => !samePath(p, path));
}
