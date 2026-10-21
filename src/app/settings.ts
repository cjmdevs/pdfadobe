// Persisted app settings. Stored by the platform (Rust JSON file / localStorage).
// No DOM or React here so it can be unit-tested in Node.

import type { Scaling } from "../platform/types";

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
}

export const MAX_RECENT = 15;

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
  };
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
