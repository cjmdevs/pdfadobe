// Plain-browser host for `npm run dev` and Playwright.
//
// Paths: readPath() fetches `/__mockfs/<encoded path>`. Nothing serves that in dev, so
// it 404s ("not found"); Playwright intercepts it with page.route() to stand in for the
// Windows file system, including locked files and network shares (see tests/e2e/fixtures.ts).
// The response's `x-mockfs-error` header carries a FileErrorKind for simulated failures.
import {
  PlatformError,
  baseName,
  type FileErrorKind,
  type OpenedFile,
  type Platform,
} from "./types";

const SETTINGS_KEY = "pdf-workbench.settings";

function pickWithInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export async function fileToOpened(file: File): Promise<OpenedFile> {
  return {
    source: { kind: "memory", name: file.name },
    name: file.name,
    bytes: await file.arrayBuffer(),
  };
}

function download(name: string, bytes: ArrayBuffer) {
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const browserPlatform: Platform = {
  kind: "browser",

  async pickFiles() {
    return Promise.all((await pickWithInput()).map(fileToOpened));
  },

  async readPath(path) {
    const res = await fetch(`/__mockfs/${encodeURIComponent(path)}`);
    const kind = res.headers.get("x-mockfs-error") as FileErrorKind | null;
    if (kind) throw new PlatformError(kind, await res.text());
    if (res.status === 404) throw new PlatformError("notFound", `could not open: not found`);
    if (!res.ok) throw new PlatformError("other", `could not open: HTTP ${res.status}`);
    return { source: { kind: "path", path }, name: baseName(path), bytes: await res.arrayBuffer() };
  },

  async takeLaunchPaths() {
    // Tests simulate "Open with" by setting this before the app boots.
    const w = window as unknown as { __PDFWB_LAUNCH_PATHS__?: string[] };
    const paths = w.__PDFWB_LAUNCH_PATHS__ ?? [];
    w.__PDFWB_LAUNCH_PATHS__ = [];
    return paths;
  },

  async onOpenPaths(cb) {
    // Tests simulate a second launch with: window.dispatchEvent(new CustomEvent("pdfwb:open-paths", { detail: [...] }))
    const handler = (e: Event) => cb((e as CustomEvent<string[]>).detail);
    window.addEventListener("pdfwb:open-paths", handler);
    return () => window.removeEventListener("pdfwb:open-paths", handler);
  },

  async onFileDrop() {
    return () => {};
  },

  async loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      return null;
    }
  },

  async saveSettings(value) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
    } catch {
      // Private mode / storage disabled: settings just don't persist.
    }
  },

  async pickSavePath(suggested) {
    return suggested;
  },

  async repair(source, target) {
    const res = await fetch(`/__mockfs-repair`, {
      method: "POST",
      body: JSON.stringify({ source, target }),
    });
    const kind = res.headers.get("x-mockfs-error") as FileErrorKind | null;
    if (kind || !res.ok) throw new PlatformError(kind ?? "unsupported", await res.text());
    return (await res.json()) as { hadWarnings: boolean };
  },

  async print() {
    throw new PlatformError("unsupported", "native printing needs the Windows app");
  },

  async saveAttachment(name, bytes) {
    download(name, bytes);
    return name;
  },

  setTitle(title) {
    document.title = title;
  },
};
