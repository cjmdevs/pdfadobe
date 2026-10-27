// Edit PDF (B3): the font index for this session. Built from the platform's folder
// listing (Windows, user, firm share mirrored for offline use) with the engine's cache,
// so only new or changed font files are read. Font bytes and metrics are cached here.

import { indexedFaces, updateFontIndex, type IndexedFace } from "../engine/edit/fonts";
import { FaceMetrics } from "../engine/edit/fonts/sfnt";
import type { Platform } from "../platform/types";

export interface FontIndex {
  faces: IndexedFace[];
  /** "offline": the firm share was unreachable and its local copy was used. */
  firm: "none" | "online" | "offline";
  bytes(face: IndexedFace): Promise<Uint8Array>;
  metrics(face: IndexedFace): Promise<FaceMetrics | null>;
}

let current: Promise<FontIndex> | null = null;

/** The index, built once per session (`refresh` rebuilds it, e.g. after a settings change). */
export function fontIndex(
  platform: Platform,
  firmPath: string | null,
  refresh = false,
): Promise<FontIndex> {
  if (!current || refresh) current = build(platform, firmPath);
  return current;
}

async function build(platform: Platform, firmPath: string | null): Promise<FontIndex> {
  const listing = await platform.fonts.list(firmPath);
  const cache = await updateFontIndex(
    await platform.fonts.loadIndex().catch(() => null),
    listing.files,
    (path) => platform.fonts.read(path),
  );
  await platform.fonts.saveIndex(cache).catch(() => undefined);
  const files = new Map<string, Promise<Uint8Array>>();
  const metrics = new Map<string, Promise<FaceMetrics | null>>();
  const bytes = (face: IndexedFace) => {
    let p = files.get(face.path);
    if (!p) {
      p = platform.fonts.read(face.path);
      files.set(face.path, p);
      // A failed read is tried again next time (the file may have been locked).
      p.catch(() => files.delete(face.path));
    }
    return p;
  };
  return {
    faces: indexedFaces(cache),
    firm: listing.firm,
    bytes,
    metrics(face) {
      const key = `${face.path}#${face.index}`;
      let p = metrics.get(key);
      if (!p) {
        p = bytes(face).then(
          (b) => new FaceMetrics(b, face.index),
          () => null,
        );
        metrics.set(key, p);
      }
      return p;
    },
  };
}
