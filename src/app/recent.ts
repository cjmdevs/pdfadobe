// Recent Files on the Home screen (backlog B2). No DOM or React here so it can be
// unit-tested in Node. Every change returns the thumbnail ids it let go of, so the caller
// deletes those images from the cache (they are pictures of client documents).

/** Windows paths are case-insensitive and accept either slash. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\//g, "\\").toLowerCase();
  return norm(a) === norm(b);
}

export interface RecentFile {
  path: string;
  /** Last opened, ms since 1970. */
  opened: number;
  /** Pinned files stay on the list until unpinned or removed. */
  pinned: boolean;
  /** Cached page-1 thumbnail id (32 hex), or null. */
  thumb: string | null;
}

export interface RecentChange {
  list: RecentFile[];
  /** Thumbnail ids no longer used by any entry. */
  dropped: string[];
}

export const MAX_RECENT = 15;
export const MAX_PINNED = 20;

const THUMB_ID = /^[0-9a-f]{32}$/;
export const isThumbId = (v: unknown): v is string => typeof v === "string" && THUMB_ID.test(v);

/** Accept whatever was on disk, including the old list of plain paths (before B2). */
export function sanitizeRecent(raw: unknown): RecentFile[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentFile[] = [];
  for (const r of raw) {
    const entry: RecentFile | null =
      typeof r === "string"
        ? { path: r, opened: 0, pinned: false, thumb: null }
        : r && typeof r === "object" && typeof (r as RecentFile).path === "string"
          ? {
              path: (r as RecentFile).path,
              opened: Number.isFinite((r as RecentFile).opened) ? (r as RecentFile).opened : 0,
              pinned: (r as RecentFile).pinned === true,
              thumb: isThumbId((r as RecentFile).thumb) ? (r as RecentFile).thumb : null,
            }
          : null;
    if (!entry || !entry.path || out.some((e) => samePath(e.path, entry.path))) continue;
    out.push(entry);
  }
  return trim(out).list;
}

/** Unpinned files beyond MAX_RECENT and pinned beyond MAX_PINNED fall off the end. */
function trim(list: RecentFile[]): RecentChange {
  let pinned = 0;
  let unpinned = 0;
  const keep: RecentFile[] = [];
  const dropped: string[] = [];
  for (const e of list) {
    const ok = e.pinned ? ++pinned <= MAX_PINNED : ++unpinned <= MAX_RECENT;
    if (ok) keep.push(e);
    else if (e.thumb) dropped.push(e.thumb);
  }
  return { list: keep, dropped };
}

const find = (list: RecentFile[], path: string) => list.find((e) => samePath(e.path, path));

/** Opened (or saved as) now: moves to the top, keeping its pin and thumbnail. */
export function touchRecent(list: RecentFile[], path: string, now: number): RecentChange {
  const old = find(list, path);
  const entry: RecentFile = old
    ? { ...old, path, opened: now }
    : { path, opened: now, pinned: false, thumb: null };
  return trim([entry, ...list.filter((e) => e !== old)]);
}

export function removeRecentFile(list: RecentFile[], path: string): RecentChange {
  const old = find(list, path);
  return {
    list: list.filter((e) => e !== old),
    dropped: old?.thumb ? [old.thumb] : [],
  };
}

export function clearRecent(list: RecentFile[]): RecentChange {
  return { list: [], dropped: list.flatMap((e) => (e.thumb ? [e.thumb] : [])) };
}

/** Pinning is refused (list unchanged) when MAX_PINNED files are already pinned. */
export function setPinned(list: RecentFile[], path: string, pinned: boolean): RecentChange {
  const old = find(list, path);
  if (!old || old.pinned === pinned) return { list, dropped: [] };
  if (pinned && list.filter((e) => e.pinned).length >= MAX_PINNED) return { list, dropped: [] };
  return trim(list.map((e) => (e === old ? { ...e, pinned } : e)));
}

export function setThumb(list: RecentFile[], path: string, thumb: string | null): RecentChange {
  const old = find(list, path);
  if (!old) return { list, dropped: thumb ? [thumb] : [] };
  return {
    list: list.map((e) => (e === old ? { ...e, thumb } : e)),
    dropped: old.thumb && old.thumb !== thumb ? [old.thumb] : [],
  };
}

/** Thumbnails off: every entry forgets its image. */
export function dropThumbs(list: RecentFile[]): RecentChange {
  return {
    list: list.map((e) => (e.thumb ? { ...e, thumb: null } : e)),
    dropped: list.flatMap((e) => (e.thumb ? [e.thumb] : [])),
  };
}

/** Pinned first, then most recently opened. */
export function displayOrder(list: RecentFile[]): RecentFile[] {
  return [...list.filter((e) => e.pinned), ...list.filter((e) => !e.pinned)];
}

/** "C:\Clients\AB\return.pdf" -> "C:\Clients\AB"; UNC and forward slashes too. */
export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i <= 0 ? "" : path.slice(0, i);
}
