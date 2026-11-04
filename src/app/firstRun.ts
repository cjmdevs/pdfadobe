// First-run setup and update checks (Phase 10a): the pure parts. Node-safe.

/** File names inside the firm library folder (decision 4, docs/phases/phase-10a.md). */
export const LIBRARY_FILES = {
  tickmarks: "tickmarks.json",
  layout: "layout.json",
  fonts: "fonts",
} as const;

/** Joins a folder and a name with one backslash (Windows and UNC paths). */
export function joinPath(folder: string, name: string): string {
  const f = folder.trim().replace(/[\\/]+$/, "");
  return `${f}\\${name}`;
}

/** The firm paths a library folder stands for. */
export function libraryPaths(folder: string): {
  firmTickmarksPath: string;
  firmLayoutPath: string;
  firmFontsPath: string;
} {
  return {
    firmTickmarksPath: joinPath(folder, LIBRARY_FILES.tickmarks),
    firmLayoutPath: joinPath(folder, LIBRARY_FILES.layout),
    firmFontsPath: joinPath(folder, LIBRARY_FILES.fonts),
  };
}

const DAY = 24 * 60 * 60 * 1000;

/** The automatic check runs at start, at most once a day (Help > Check for updates
 * always runs). A clock set back counts as due. */
export function updateCheckDue(last: number, now: number): boolean {
  return now - last >= DAY || now < last;
}
