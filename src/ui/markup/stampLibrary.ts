// The stamp tool's library (B6): the built-in sets and the user's custom stamps under
// one reference each ("b:approved", "c:<id>"), with a picture for menus and the palette.
// Custom stamps' images are kept as object URLs while the app runs.
import { useEffect, useSyncExternalStore } from "react";
import type { WorkbenchApi } from "../../app/workbench";
import {
  STAMP_SETS,
  TEXT_STAMPS,
  dynamicText,
  stampTitle,
  type TextStampDef,
} from "../../engine/stamps";
import { platform, type CustomStamp } from "../../platform";
import type { MenuItem, StampPreview } from "../../tools/registry";

export interface StampEntry {
  ref: string;
  name: string;
  category: string;
  builtIn?: TextStampDef;
  custom?: CustomStamp;
  preview: StampPreview;
}

/** Category of custom stamps that were given none. */
export const DEFAULT_CATEGORY = "My Stamps";

let custom: { stamp: CustomStamp; url: string }[] = [];
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  for (const l of listeners) l();
};

/** Reads the custom stamps again (after one is added or removed). */
export async function reloadStamps(): Promise<void> {
  const list = await platform.stamps.list().catch(() => [] as CustomStamp[]);
  const next = await Promise.all(
    list.map(async (stamp) => {
      const old = custom.find((c) => c.stamp.id === stamp.id);
      if (old) return old;
      const bytes = await platform.stamps.read(stamp.id).catch(() => new Uint8Array());
      const url = URL.createObjectURL(new Blob([bytes.slice()], { type: stamp.mime }));
      return { stamp, url };
    }),
  );
  for (const c of custom) if (!next.includes(c)) URL.revokeObjectURL(c.url);
  custom = next;
  notify();
}

let loaded = false;
function loadOnce() {
  if (loaded) return;
  loaded = true;
  void reloadStamps();
}

/** Re-renders when the custom stamps change; loads them the first time. */
export function useStampLibraryVersion(): number {
  useEffect(loadOnce, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => version,
  );
}

/** Every stamp: the built-in sets in Acrobat's order, then custom ones by category. */
export function allStamps(wb: WorkbenchApi): StampEntry[] {
  const sample = new Date();
  const label = (id: string) => STAMP_SETS.find((s) => s.id === id)?.label ?? id;
  const built = TEXT_STAMPS.map((d): StampEntry => ({
    ref: `b:${d.id}`,
    name: stampTitle(d),
    category: label(d.set),
    builtIn: d,
    preview: {
      title: d.title,
      color: d.color,
      ...(d.dynamic ? { detail: dynamicText(d, wb.author, sample) ?? "" } : {}),
      ...(d.dynamic === "nameAbove" ? { above: true } : {}),
    },
  }));
  const info = wb.settings.customStampInfo;
  const mine = custom
    .map(({ stamp, url }): StampEntry => {
      const i = info[stamp.id];
      return {
        ref: `c:${stamp.id}`,
        name: i?.name ?? stamp.name,
        category: i?.category ?? DEFAULT_CATEGORY,
        custom: stamp,
        preview: { url },
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return [...built, ...mine];
}

/** Category names in menu order. */
export function stampCategories(entries: StampEntry[]): string[] {
  return [...new Set(entries.map((e) => e.category))];
}

/** Acrobat's Stamp menu: the last stamp, favourites, a submenu per category, then the
 * favourites, names and clipboard commands. */
export function stampMenu(wb: WorkbenchApi, entries: StampEntry[]): MenuItem[] {
  const { lastStamp, stampFavorites, showStampNames } = wb.settings;
  const pick = (e: StampEntry, id = e.ref): MenuItem => ({
    id,
    label: e.name,
    title: `${e.name} (${e.category})`,
    ...(showStampNames ? {} : { stamp: e.preview }),
    run: (c) => c.markup?.pickStamp(e.ref),
  });
  const byRef = new Map(entries.map((e) => [e.ref, e]));
  const last = lastStamp ? byRef.get(lastStamp) : undefined;
  const favs = stampFavorites.flatMap((r) => byRef.get(r) ?? []);
  const items: MenuItem[] = [];
  if (last) items.push(pick(last, `last:${last.ref}`));
  favs.forEach((e, i) => items.push({ ...pick(e, `fav:${e.ref}`), separator: i === 0 }));
  stampCategories(entries).forEach((cat, i) =>
    items.push({
      id: `cat:${cat}`,
      label: cat,
      separator: i === 0 && items.length > 0,
      items: entries.filter((e) => e.category === cat).map((e) => pick(e)),
      run: () => {},
    }),
  );
  const isFav = last ? stampFavorites.includes(last.ref) : false;
  const setFavs = (next: string[]) => wb.updateSettings({ stampFavorites: next });
  items.push(
    {
      id: "addFavorite",
      label: "Add Current Stamp To Favorites",
      separator: true,
      disabled: !last || isFav,
      run: () => last && setFavs([...stampFavorites, last.ref]),
    },
    {
      id: "removeFavorite",
      label: "Remove Current Stamp From Favorites",
      disabled: !isFav,
      run: () => setFavs(stampFavorites.filter((r) => r !== last?.ref)),
    },
    {
      id: "showNames",
      label: "Show Stamp Names",
      separator: true,
      check: true,
      checked: showStampNames,
      run: () => wb.updateSettings({ showStampNames: !showStampNames }),
    },
    {
      id: "paste",
      label: "Paste Clipboard Image as Stamp Tool",
      separator: true,
      run: (c) => c.markup?.pasteStamp(),
    },
  );
  return items;
}
