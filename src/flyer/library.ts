// Tickmark library (Phase 4): the built-in firm set, the firm file on the share (read-only
// in the app) and the user's own tickmarks, plus the one JSON file that carries a
// firm's or a user's workpaper settings. Node-safe, no React.

import {
  BUILT_IN_TICKMARKS,
  TICK_MARKS,
  type TickMark,
  type TickmarkDef,
} from "../engine/flyer/tickmarks";
import { BUILT_IN_STAMPS, type StampTemplate } from "../engine/flyer/userStamps";

export const SETTINGS_FORMAT = "pdf-workbench-workpaper";

/** The export/import file (firm standard or one user's). Calculator settings join it in
 * stage 3. */
export interface WorkpaperFile {
  format: typeof SETTINGS_FORMAT;
  version: 1;
  tickmarks: TickmarkDef[];
  /** User and status stamp templates (stage 2; absent in stage 1 files). */
  stamps: StampTemplate[];
}

export type TickmarkSource = "built-in" | "firm" | "mine";

export interface LibraryEntry {
  def: TickmarkDef;
  source: TickmarkSource;
}

/** Recent list length. */
export const MAX_RECENT_TICKMARKS = 8;
const MAX_IMAGE_B64 = 400_000;

const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const str = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** A tickmark from a file or settings, or null when it is not usable. */
export function sanitizeTickmark(raw: unknown): TickmarkDef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 80);
  const name = str(r.name, 80);
  if (!id || !/^[\w.-]+$/.test(id) || !name) return null;
  const def: TickmarkDef = {
    id,
    name,
    meaning: str(r.meaning, 200) ?? name,
    color: isColor(r.color) ? r.color : "#D0021B",
    size:
      typeof r.size === "number" && Number.isFinite(r.size)
        ? Math.min(72, Math.max(6, r.size))
        : 14,
  };
  if (TICK_MARKS.includes(r.mark as TickMark)) def.mark = r.mark as TickMark;
  const text = str(r.text, 6);
  if (text) def.text = text;
  if (r.circle === true) def.circle = true;
  if (r.sequence === "letters" || r.sequence === "numbers") def.sequence = r.sequence;
  const img = r.image as Record<string, unknown> | undefined;
  if (
    img &&
    (img.mime === "image/png" || img.mime === "image/jpeg") &&
    typeof img.data === "string" &&
    img.data.length <= MAX_IMAGE_B64 &&
    /^[A-Za-z0-9+/=]+$/.test(img.data)
  )
    def.image = { mime: img.mime, data: img.data };
  // Something must be drawn.
  if (!def.mark && !def.text && !def.sequence && !def.image) return null;
  return def;
}

export function sanitizeTickmarks(v: unknown, max = 200): TickmarkDef[] {
  if (!Array.isArray(v)) return [];
  const out: TickmarkDef[] = [];
  for (const x of v) {
    const d = sanitizeTickmark(x);
    if (d && !out.some((o) => o.id === d.id)) out.push(d);
    if (out.length >= max) break;
  }
  return out;
}

export function sanitizeStampTemplate(raw: unknown): StampTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 80);
  const title = str(r.title, 40);
  if (!id || !/^[\w.-]+$/.test(id) || !title) return null;
  const flag = (k: string, d: boolean) => (typeof r[k] === "boolean" ? (r[k] as boolean) : d);
  return {
    id,
    title,
    kind: r.kind === "user" ? "user" : "status",
    color: isColor(r.color) ? r.color : "#1F4E9C",
    showName: flag("showName", true),
    showDate: flag("showDate", true),
    showTime: flag("showTime", true),
    showRef: flag("showRef", true),
    fields: Array.isArray(r.fields)
      ? r.fields
          .map((f) => str(f, 30))
          .filter((f): f is string => f !== null)
          .slice(0, 6)
      : [],
  };
}

export function sanitizeStampTemplates(v: unknown, max = 50): StampTemplate[] {
  if (!Array.isArray(v)) return [];
  const out: StampTemplate[] = [];
  for (const x of v) {
    const t = sanitizeStampTemplate(x);
    if (t && !out.some((o) => o.id === t.id)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function makeWorkpaperFile(
  tickmarks: TickmarkDef[],
  stamps: StampTemplate[] = [],
): WorkpaperFile {
  return { format: SETTINGS_FORMAT, version: 1, tickmarks, stamps };
}

/** Reads an exported file; throws a readable error when it is not one. */
export function parseWorkpaperFile(text: string): WorkpaperFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (r.format !== SETTINGS_FORMAT)
    throw new Error("This is not a PDF Workbench workpaper settings file.");
  return makeWorkpaperFile(sanitizeTickmarks(r.tickmarks), sanitizeStampTemplates(r.stamps));
}

/** Built-in first, then the firm file, then the user's own. A firm or personal tickmark
 * with a built-in's id replaces it (the firm can redraw the standard set). */
export function mergeLibrary(firm: TickmarkDef[], mine: TickmarkDef[]): LibraryEntry[] {
  const out: LibraryEntry[] = BUILT_IN_TICKMARKS.map((def) => ({ def, source: "built-in" }));
  const put = (def: TickmarkDef, source: TickmarkSource) => {
    const i = out.findIndex((e) => e.def.id === def.id);
    if (i >= 0) out[i] = { def, source };
    else out.push({ def, source });
  };
  for (const d of firm) put(d, "firm");
  for (const d of mine) put(d, "mine");
  return out;
}

/** Stamp templates in the same order and with the same replace rule as tickmarks. */
export function mergeStamps(
  firm: StampTemplate[],
  mine: StampTemplate[],
): { def: StampTemplate; source: TickmarkSource }[] {
  const out: { def: StampTemplate; source: TickmarkSource }[] = BUILT_IN_STAMPS.map((def) => ({
    def,
    source: "built-in",
  }));
  const put = (def: StampTemplate, source: TickmarkSource) => {
    const i = out.findIndex((e) => e.def.id === def.id);
    if (i >= 0) out[i] = { def, source };
    else out.push({ def, source });
  };
  for (const d of firm) put(d, "firm");
  for (const d of mine) put(d, "mine");
  return out;
}

export function pushRecent(recent: string[], id: string): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, MAX_RECENT_TICKMARKS);
}

/** Adds or replaces imported tickmarks (or stamps) in the user's own list. */
export function importTickmarks<T extends { id: string }>(mine: T[], incoming: T[]): T[] {
  const out = mine.filter((m) => !incoming.some((i) => i.id === m.id));
  return [...out, ...incoming];
}
