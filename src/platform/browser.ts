// Plain-browser host for `npm run dev` and Playwright.
//
// Paths: readPath() fetches `/__mockfs/<encoded path>`. Nothing serves that in dev, so
// it 404s ("not found"); Playwright intercepts it with page.route() to stand in for the
// Windows file system, including locked files and network shares (see tests/e2e/fixtures.ts).
// The response's `x-mockfs-error` header carries a FileErrorKind for simulated failures.
import type { FontIndexCache } from "../engine/edit/fonts";
import { MemoryDocStore } from "../app/docstore";
import { decodeResult, encodeJob } from "../engine/pages/qpdf-wire";
import { QpdfError } from "../engine/pages/qpdf";
import { OcrError } from "../engine/ocr/tesseract";
import { browserTestCert } from "./browserCert";
import {
  PlatformError,
  baseName,
  type FileErrorKind,
  type OpenedFile,
  type AppWindows,
  type CertProvider,
  type CustomStamp,
  type SavedSignature,
  type SignatureLibrary,
  type StampLibrary,
  type FontFolders,
  type Platform,
} from "./types";

const SETTINGS_KEY = "pdf-workbench.settings";

function pickWithInput(
  images = false,
  xfdf = false,
  pictures = false,
  json = false,
  formData = false,
  csv = false,
  pfx = false,
): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = pfx
      ? ".pfx,.p12"
      : formData
        ? ".fdf,.xfdf,.json,.csv"
        : csv
          ? ".csv,text/csv"
          : json
            ? ".json,application/json"
            : xfdf
              ? ".xfdf,application/vnd.adobe.xfdf"
              : pictures
                ? "image/jpeg,image/png,.jpg,.jpeg,.png"
                : images
                  ? "application/pdf,.pdf,image/jpeg,image/png,image/tiff,.tif,.tiff"
                  : "application/pdf,.pdf";
    input.multiple = !pictures && !formData && !csv && !pfx;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

async function mockWrite(path: string, bytes: Uint8Array, mode: "save" | "saveAs" | "new") {
  return fetch(`/__mockfs/${encodeURIComponent(path)}?mode=${mode}`, {
    method: "PUT",
    body: bytes.slice(),
  });
}

async function mockError(res: Response): Promise<void> {
  const kind = res.headers.get("x-mockfs-error") as FileErrorKind | null;
  if (kind) throw new PlatformError(kind, await res.text());
  if (!res.ok) throw new PlatformError("other", `mock file system: HTTP ${res.status}`);
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

const docs = new MemoryDocStore();

/**
 * E2E stand-in for other windows (the browser has one). Enabled when a test sets
 * `window.__PDFWB_FAKE_WINDOWS__ = {}` before load: tabs "moved" out go to a pretend
 * window "w-2", and the test hands them back through `queue` + `adopt()`.
 */
export interface FakeWindows {
  queue: string[];
  moved: string[];
  focused: string[];
  closed: number;
  quits: number;
  adopt?: () => void;
  focusDoc?: (id: string) => void;
  requestClose?: () => Promise<boolean>;
}

function fakeWindows(): AppWindows | null {
  const w = window as unknown as { __PDFWB_FAKE_WINDOWS__?: Partial<FakeWindows> };
  const init = w.__PDFWB_FAKE_WINDOWS__;
  if (!init) return null;
  const f: FakeWindows = { queue: [], moved: [], focused: [], closed: 0, quits: 0, ...init };
  w.__PDFWB_FAKE_WINDOWS__ = f;
  const away = (ids: string[]) => {
    for (const id of ids) docs.setWindow(id, "w-2");
    f.moved.push(...ids);
  };
  return {
    label: "main",
    async tabDrop(ids) {
      away(ids);
      return true;
    },
    async moveToNewWindow(ids) {
      away(ids);
    },
    async takeDocs() {
      const ids = f.queue.splice(0);
      for (const id of ids) docs.setWindow(id, "main");
      return ids;
    },
    async onAdopt(cb) {
      f.adopt = cb;
      return () => undefined;
    },
    async focusDoc(id) {
      f.focused.push(id);
      return true;
    },
    async onFocusDoc(cb) {
      f.focusDoc = cb;
      return () => undefined;
    },
    async onCloseRequested(cb) {
      f.requestClose = cb;
      return () => undefined;
    },
    async closeWindow() {
      f.closed++;
    },
    async saveDoc(id) {
      const info = await docs.info(id);
      if (!info.path) throw new Error("never saved");
      await browserPlatform.save(info.path, await docs.current(id));
      return docs.markSaved(id);
    },
    async quit() {
      f.quits++;
    },
  };
}

/**
 * Browser build: font folders exist only when a test serves them (`/__mockfonts-list`,
 * `/__mockfonts/<path>`); otherwise there are none and Edit PDF offers the document's
 * own and the standard fonts.
 */
let sessionFontIndex: FontIndexCache | null = null;
const fonts: FontFolders = {
  async list(firm) {
    const res = await fetch(`/__mockfonts-list?firm=${encodeURIComponent(firm ?? "")}`).catch(
      () => null,
    );
    if (!res?.ok || !res.headers.get("content-type")?.includes("json"))
      return { files: [], firm: "none" };
    return (await res.json()) as Awaited<ReturnType<FontFolders["list"]>>;
  },
  read: async (path) => {
    const res = await fetch(`/__mockfonts/${encodeURIComponent(path)}`).catch(() => null);
    if (!res?.ok) throw new PlatformError("notFound", "font file not available");
    return new Uint8Array(await res.arrayBuffer());
  },
  loadIndex: async () => sessionFontIndex,
  saveIndex: async (cache) => {
    sessionFontIndex = cache;
  },
};

/** Browser build: custom stamps last for the session (tests, development). */
const sessionStamps = new Map<string, { info: CustomStamp; bytes: Uint8Array }>();
const stamps: StampLibrary = {
  list: async () => [...sessionStamps.values()].map((s) => s.info),
  read: async (id) => {
    const s = sessionStamps.get(id);
    if (!s) throw new PlatformError("notFound", "this stamp no longer exists");
    return s.bytes;
  },
  add: async (name, bytes) => {
    const mime =
      bytes[0] === 0x89 && bytes[1] === 0x50
        ? "image/png"
        : bytes[0] === 0xff && bytes[1] === 0xd8
          ? "image/jpeg"
          : null;
    if (!mime) throw new PlatformError("other", "only PNG and JPEG images can be stamps");
    const info: CustomStamp = { id: crypto.randomUUID(), name: name.trim().slice(0, 60), mime };
    sessionStamps.set(info.id, { info, bytes });
    return info;
  },
  remove: async (id) => {
    sessionStamps.delete(id);
  },
};

/** Browser build: saved signatures last for the session (tests, development). */
const sessionSignatures = new Map<string, { info: SavedSignature; bytes: Uint8Array }>();
const signatures: SignatureLibrary = {
  list: async () => [...sessionSignatures.values()].map((s) => s.info),
  read: async (id) => {
    const s = sessionSignatures.get(id);
    if (!s) throw new PlatformError("notFound", "this saved signature could not be read");
    return s.bytes;
  },
  add: async (kind, bytes) => {
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) {
      throw new PlatformError("other", "a saved signature must be a PNG image");
    }
    const info: SavedSignature = { id: crypto.randomUUID(), kind };
    sessionSignatures.set(info.id, { info, bytes });
    return info;
  },
  remove: async (id) => {
    sessionSignatures.delete(id);
  },
};

/** Browser build: one throwaway test certificate made with WebCrypto (e2e tests). */
const certs: CertProvider = {
  list: async () => [(await browserTestCert()).info],
  sign: async (_thumbprint, data) => (await browserTestCert()).sign(data),
  pfxOpen: async () => {
    throw new PlatformError("unsupported", ".pfx files can only be used in the Windows app");
  },
  pfxSign: async () => {
    throw new PlatformError("unsupported", ".pfx files can only be used in the Windows app");
  },
};

export const browserPlatform: Platform = {
  kind: "browser",

  // No OS account in the browser build (tests can set one).
  async userDisplayName() {
    return (window as unknown as { __PDFWB_USER__?: string }).__PDFWB_USER__ ?? null;
  },

  async pickFiles(opts) {
    return Promise.all(
      (
        await pickWithInput(
          opts?.images,
          opts?.xfdf,
          opts?.pictures,
          opts?.json,
          opts?.formData,
          opts?.csv,
          opts?.pfx,
        )
      ).map(fileToOpened),
    );
  },

  async pickFolder() {
    // Tests queue folder choices in window.__PDFWB_NEXT_FOLDERS__.
    const w = window as unknown as { __PDFWB_NEXT_FOLDERS__?: string[] };
    return w.__PDFWB_NEXT_FOLDERS__?.shift() ?? null;
  },

  async listFolder(path) {
    const res = await fetch(`/__mockfs-list/${encodeURIComponent(path)}`);
    await mockError(res);
    return (await res.json()) as string[];
  },

  async save(path, bytes) {
    await mockError(await mockWrite(path, bytes, "save"));
  },

  async saveAs(target, source, bytes) {
    if (source && target.toLowerCase() === source.toLowerCase()) {
      throw new PlatformError("other", "Save As target is the original file; choose a new name");
    }
    await mockError(await mockWrite(target, bytes, "saveAs"));
  },

  async discardBackup() {
    // Nothing to clean up in the mock file system.
  },

  async writeNewFile(folder, name, bytes) {
    const res = await mockWrite(`${folder}\\${name}`, bytes, "new");
    await mockError(res);
    return res.text();
  },

  docs,
  stamps,
  signatures,
  certs,
  fonts,
  get windows() {
    return fakeWindowsOnce();
  },
  qpdf: {
    // Playwright runs qpdf for /__qpdf (tests/e2e/fixtures.ts). Plain `npm run dev` has no
    // qpdf: page operations need the Windows app.
    async run(job) {
      const res = await fetch("/__qpdf", { method: "POST", body: encodeJob(job).slice() });
      if (res.status === 404) throw new QpdfError("Page operations need the Windows app (qpdf).");
      if (!res.ok) throw new QpdfError(await res.text());
      return decodeResult(new Uint8Array(await res.arrayBuffer()));
    },
  },
  ocr: {
    // Playwright runs the bundled Tesseract for /__ocr (tests/e2e/fixtures.ts).
    async run(job) {
      const res = await fetch("/__ocr", { method: "POST", body: encodeJob(job).slice() });
      if (res.status === 404) throw new OcrError("Recognize Text needs the Windows app.");
      if (!res.ok) throw new OcrError(await res.text());
      const { files, stdout } = decodeResult(new Uint8Array(await res.arrayBuffer()));
      return { files, stdout };
    },
    async cancel(id) {
      await fetch(`/__ocr-cancel?id=${id}`, { method: "POST" });
    },
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
    // Tests queue Save As answers in window.__PDFWB_NEXT_SAVE_PATHS__.
    const w = window as unknown as { __PDFWB_NEXT_SAVE_PATHS__?: string[] };
    return w.__PDFWB_NEXT_SAVE_PATHS__?.shift() ?? suggested;
  },

  // Tests read what was opened from window.__PDFWB_EXTEDIT__ and hand back an edited
  // image by setting its `reply` (given back once).
  externalEdit: {
    async start(bytes, ext, app) {
      const w = window as unknown as { __PDFWB_EXTEDIT__?: ExtEditMock[] };
      const list = (w.__PDFWB_EXTEDIT__ ??= []);
      list.push({ bytes, ext, app, reply: null, ended: false });
      return list.length;
    },
    async poll(id) {
      const w = window as unknown as { __PDFWB_EXTEDIT__?: ExtEditMock[] };
      const e = w.__PDFWB_EXTEDIT__?.[id - 1];
      const r = e?.reply ?? null;
      if (e) e.reply = null;
      return r;
    },
    async end(id) {
      const w = window as unknown as { __PDFWB_EXTEDIT__?: ExtEditMock[] };
      const e = w.__PDFWB_EXTEDIT__?.[id - 1];
      if (e) e.ended = true;
    },
  },

  async openUrl(url) {
    // Tests read what was opened from window.__PDFWB_OPENED__ (no browser launch here).
    const w = window as unknown as { __PDFWB_OPENED__?: string[] };
    (w.__PDFWB_OPENED__ ??= []).push(url);
  },

  async openInAcrobat(path) {
    // Tests read the request from window.__PDFWB_ACROBAT__ (no Acrobat in a browser).
    const w = window as unknown as { __PDFWB_ACROBAT__?: string[] };
    (w.__PDFWB_ACROBAT__ ??= []).push(path);
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

let fake: AppWindows | null | undefined;
function fakeWindowsOnce() {
  if (fake === undefined) fake = fakeWindows();
  return fake;
}

interface ExtEditMock {
  bytes: Uint8Array;
  ext: string;
  app: string;
  reply: Uint8Array | null;
  ended: boolean;
}
