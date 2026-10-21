import { browserPlatform } from "./browser";
import { tauriPlatform } from "./tauri";
import type { Platform } from "./types";

export * from "./types";
export { fileToOpened } from "./browser";

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export const platform: Platform = isTauri() ? tauriPlatform : browserPlatform;
