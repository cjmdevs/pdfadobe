// Dialogs for page operations: insert (PDF or images), replace, blank page, crop, page
// size, split, Combine Files, and the unsaved-changes prompt.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import {
  formatRanges,
  parseRanges,
  partsByBookmarks,
  partsByCount,
  sniffImage,
  titleFromFileName,
  type SplitResult,
} from "../engine/pages";
import type { DocInfo } from "../app/docstore";
import { pageOp } from "../app/pages";
import { usePageActions } from "../app/pageActions";
import { useWorkbench, type ConfirmRequest, type PageOpDialog } from "../app/workbench";
import {
  PlatformError,
  baseName,
  dirName,
  platform,
  safeFileName,
  type OpenedFile,
} from "../platform";
import { usePointerDrag } from "./usePointerDrag";

export function FormModal({
  title,
  submit,
  onSubmit,
  onClose,
  children,
  busy,
  wide,
  danger,
}: {
  title: string;
  submit: string;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
  wide?: boolean;
  danger?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const go = (e: FormEvent) => {
    e.preventDefault();
    void onSubmit();
  };
  return (
    <dialog
      ref={ref}
      className={`modal${wide ? " wide" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form onSubmit={go}>
        <header>
          <h2>{title}</h2>
        </header>
        <div className="modal-body">{children}</div>
        <footer className="button-row">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={danger ? "primary danger-fill" : "primary"}
            disabled={busy}
          >
            {submit}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

/** Which pages an operation applies to: all, the selection, or a typed range. */
function useScope(pageCount: number, selected: number[]) {
  // Default to the selection (or the current page): changes must not hit every page
  // unless the user asks for that.
  const [scope, setScope] = useState<"all" | "selected" | "range">(
    selected.length ? "selected" : "all",
  );
  const [text, setText] = useState(formatRanges(selected));
  const pages = (): number[] =>
    scope === "all"
      ? Array.from({ length: pageCount }, (_, i) => i)
      : scope === "selected"
        ? selected
        : parseRanges(text, pageCount);
  const ui = (
    <fieldset className="scope">
      <legend>Apply to</legend>
      <label>
        <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> All pages
      </label>
      <label>
        <input type="radio" checked={scope === "selected"} onChange={() => setScope("selected")} />{" "}
        {selected.length === 1 ? "This page" : "Selected pages"} ({formatRanges(selected)})
      </label>
      <label>
        <input type="radio" checked={scope === "range"} onChange={() => setScope("range")} /> Pages{" "}
        <input
          aria-label="Page range"
          className="range-input"
          value={text}
          onFocus={() => setScope("range")}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. 1-3, 5"
        />
      </label>
    </fieldset>
  );
  return { pages, ui };
}

function ErrorText({ text }: { text: string | null }) {
  return text ? (
    <p className="error" role="alert">
      {text}
    </p>
  ) : null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PageOpDialogView({
  op,
  documentId,
  pages,
  onClose,
}: {
  op: PageOpDialog;
  documentId: string;
  pages: number[];
  onClose: () => void;
}) {
  const doc = useDocumentState(documentId)?.document ?? null;
  if (!doc) return null;
  const props = { documentId, pages, pageCount: doc.pageCount, onClose };
  switch (op) {
    case "blank":
      return <BlankDialog {...props} />;
    case "insert":
      return <InsertDialog {...props} />;
    case "replace":
      return <ReplaceDialog {...props} />;
    case "crop":
      return <CropDialog {...props} />;
    case "pageSize":
      return <PageSizeDialog {...props} />;
    case "split":
      return <SplitDialog {...props} />;
  }
}

interface OpProps {
  documentId: string;
  pages: number[];
  pageCount: number;
  onClose: () => void;
}

/** "Before page N" / "After page N" / first / last, as an insertion index. */
function usePosition(pageCount: number, selected: number[]) {
  const last = selected.length ? Math.max(...selected) : pageCount - 1;
  const [where, setWhere] = useState<"after" | "before" | "first" | "last">("after");
  const [page, setPage] = useState(String(last + 1));
  const at = (): number => {
    if (where === "first") return 0;
    if (where === "last") return pageCount;
    const n = Number(page);
    if (!Number.isInteger(n) || n < 1 || n > pageCount)
      throw new RangeError(`page must be 1-${pageCount}`);
    return where === "after" ? n : n - 1;
  };
  const ui = (
    <div className="field-row">
      <label>
        Location{" "}
        <select
          aria-label="Location"
          value={where}
          onChange={(e) => setWhere(e.target.value as typeof where)}
        >
          <option value="after">After page</option>
          <option value="before">Before page</option>
          <option value="first">First</option>
          <option value="last">Last</option>
        </select>
      </label>
      {(where === "after" || where === "before") && (
        <input
          aria-label="Page number"
          className="num-input"
          value={page}
          onChange={(e) => setPage(e.target.value)}
        />
      )}
    </div>
  );
  return { at, ui };
}

const SIZES: Record<string, { label: string; width: number; height: number }> = {
  letter: { label: "Letter (8.5 × 11 in)", width: 612, height: 792 },
  legal: { label: "Legal (8.5 × 14 in)", width: 612, height: 1008 },
  tabloid: { label: "Tabloid (11 × 17 in)", width: 792, height: 1224 },
  a4: { label: "A4 (210 × 297 mm)", width: 595.28, height: 841.89 },
  a3: { label: "A3 (297 × 420 mm)", width: 841.89, height: 1190.55 },
};

function BlankDialog({ documentId, pages, pageCount, onClose }: OpProps) {
  const actions = usePageActions(documentId);
  const pos = usePosition(pageCount, pages);
  const [count, setCount] = useState("1");
  const [size, setSize] = useState("same");
  const [err, setErr] = useState<string | null>(null);
  return (
    <FormModal
      title="Insert blank pages"
      submit="Insert"
      onClose={onClose}
      onSubmit={async () => {
        try {
          const n = Number(count);
          if (!Number.isInteger(n) || n < 1 || n > 500) throw new RangeError("count must be 1-500");
          const at = pos.at();
          const s = SIZES[size];
          onClose();
          await actions.insertBlank(at, n, s ? { width: s.width, height: s.height } : undefined);
        } catch (e) {
          setErr(message(e));
        }
      }}
    >
      {pos.ui}
      <div className="field-row">
        <label>
          Number of pages{" "}
          <input
            className="num-input"
            aria-label="Number of pages"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
        <label>
          Size{" "}
          <select aria-label="Size" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="same">Same as neighbouring page</option>
            {Object.entries(SIZES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorText text={err} />
    </FormModal>
  );
}

/** A picked PDF, or images turned into one (one page per image, TIFF pages included). */
async function asPdf(files: OpenedFile[]): Promise<{ name: string; bytes: Uint8Array }> {
  const first = files[0];
  if (!first) throw new RangeError("no file chosen");
  const all = files.map((f) => new Uint8Array(f.bytes));
  if (files.length === 1 && !sniffImage(all[0] ?? new Uint8Array())) {
    return { name: first.name, bytes: all[0] ?? new Uint8Array() };
  }
  if (!all.every((b) => sniffImage(b))) throw new RangeError("choose one PDF, or images only");
  return { name: first.name, bytes: await pageOp("imagesToPdf", all) };
}

function useSourceFile() {
  const [src, setSrc] = useState<{ name: string; bytes: Uint8Array; pageCount: number } | null>(
    null,
  );
  const [err, setErr] = useState<string | null>(null);
  const pick = async () => {
    setErr(null);
    try {
      const files = await platform.pickFiles({ images: true });
      if (!files.length) return;
      const pdf = await asPdf(files);
      const pageCount = await pageOp("pageCount", pdf.bytes);
      setSrc({ ...pdf, pageCount });
    } catch (e) {
      setErr(e instanceof PlatformError ? e.message : `Could not read the file: ${message(e)}`);
    }
  };
  const ui = (
    <div className="field-row">
      <button type="button" onClick={() => void pick()}>
        Choose file…
      </button>
      <span data-testid="source-file">
        {src
          ? `${src.name} (${src.pageCount} page${src.pageCount === 1 ? "" : "s"})`
          : "PDF, JPG, PNG or TIFF"}
      </span>
    </div>
  );
  return { src, ui, err };
}

function InsertDialog({ documentId, pages, pageCount, onClose }: OpProps) {
  const actions = usePageActions(documentId);
  const file = useSourceFile();
  const pos = usePosition(pageCount, pages);
  const [range, setRange] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <FormModal
      title="Insert pages"
      submit="Insert"
      onClose={onClose}
      busy={!file.src}
      onSubmit={async () => {
        try {
          if (!file.src) return;
          const theirs = parseRanges(range, file.src.pageCount);
          const at = pos.at();
          onClose();
          await actions.insertFrom(file.src.bytes, theirs, at);
        } catch (e) {
          setErr(message(e));
        }
      }}
    >
      {file.ui}
      <div className="field-row">
        <label>
          Pages to insert{" "}
          <input
            className="range-input"
            aria-label="Pages to insert"
            value={range}
            placeholder="All"
            onChange={(e) => setRange(e.target.value)}
          />
        </label>
      </div>
      {pos.ui}
      <ErrorText text={file.err ?? err} />
    </FormModal>
  );
}

function ReplaceDialog({ documentId, pages, pageCount, onClose }: OpProps) {
  const actions = usePageActions(documentId);
  const file = useSourceFile();
  const [targets, setTargets] = useState(formatRanges(pages));
  const [theirs, setTheirs] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <FormModal
      title="Replace pages"
      submit="Replace"
      onClose={onClose}
      busy={!file.src}
      onSubmit={async () => {
        try {
          if (!file.src) return;
          const t = parseRanges(targets, pageCount);
          const o = theirs.trim()
            ? parseRanges(theirs, file.src.pageCount)
            : t.map((_, i) => i).filter((i) => i < (file.src?.pageCount ?? 0));
          if (o.length !== t.length)
            throw new RangeError(
              `Replacing ${t.length} page(s) needs ${t.length} page(s) from the other file.`,
            );
          onClose();
          await actions.replace(t, file.src.bytes, o);
        } catch (e) {
          setErr(message(e));
        }
      }}
    >
      <div className="field-row">
        <label>
          Replace pages{" "}
          <input
            className="range-input"
            aria-label="Pages to replace"
            value={targets}
            onChange={(e) => setTargets(e.target.value)}
          />
        </label>
      </div>
      {file.ui}
      <div className="field-row">
        <label>
          With pages{" "}
          <input
            className="range-input"
            aria-label="Replacement pages"
            value={theirs}
            placeholder="From page 1"
            onChange={(e) => setTheirs(e.target.value)}
          />
        </label>
      </div>
      <p className="muted small">
        Bookmarks that pointed at a replaced page point at its replacement.
      </p>
      <ErrorText text={file.err ?? err} />
    </FormModal>
  );
}

const IN = 72;

function CropDialog({ documentId, pages, pageCount, onClose }: OpProps) {
  const actions = usePageActions(documentId);
  const scope = useScope(pageCount, pages);
  const [m, setM] = useState({ left: "0", top: "0", right: "0", bottom: "0" });
  const [err, setErr] = useState<string | null>(null);
  const side = (k: keyof typeof m, label: string) => (
    <label>
      {label}{" "}
      <input
        className="num-input"
        aria-label={`${label} margin`}
        value={m[k]}
        onChange={(e) => setM({ ...m, [k]: e.target.value })}
      />{" "}
      in
    </label>
  );
  return (
    <FormModal
      title="Crop pages"
      submit="Crop"
      onClose={onClose}
      onSubmit={async () => {
        try {
          const v = Object.fromEntries(
            Object.entries(m).map(([k, s]) => {
              const n = Number(s);
              if (!Number.isFinite(n) || n < 0) throw new RangeError(`${k} margin must be ≥ 0`);
              return [k, n * IN];
            }),
          ) as { left: number; top: number; right: number; bottom: number };
          const p = scope.pages();
          onClose();
          await actions.crop(p, v);
        } catch (e) {
          setErr(message(e));
        }
      }}
    >
      <p className="muted small">
        Margins to trim from each page as it appears on screen. Content outside the crop is hidden,
        not removed (use redaction to remove content).
      </p>
      <div className="field-grid">
        {side("top", "Top")}
        {side("bottom", "Bottom")}
        {side("left", "Left")}
        {side("right", "Right")}
      </div>
      {scope.ui}
      <ErrorText text={err} />
    </FormModal>
  );
}

function PageSizeDialog({ documentId, pages, pageCount, onClose }: OpProps) {
  const actions = usePageActions(documentId);
  const scope = useScope(pageCount, pages);
  const [preset, setPreset] = useState("letter");
  const [landscape, setLandscape] = useState(false);
  const [custom, setCustom] = useState({ w: "8.5", h: "11" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <FormModal
      title="Set page size"
      submit="Apply"
      onClose={onClose}
      onSubmit={async () => {
        try {
          const s = SIZES[preset];
          let w = s ? s.width : Number(custom.w) * IN;
          let h = s ? s.height : Number(custom.h) * IN;
          if (!(w >= 72 && h >= 72 && w <= 200 * IN && h <= 200 * IN))
            throw new RangeError("size must be between 1 and 200 inches");
          if (landscape !== w > h) [w, h] = [h, w];
          const p = scope.pages();
          onClose();
          await actions.setSize(p, { width: w, height: h });
        } catch (e) {
          setErr(message(e));
        }
      }}
    >
      <div className="field-row">
        <label>
          Size{" "}
          <select aria-label="Page size" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {Object.entries(SIZES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={landscape}
            onChange={(e) => setLandscape(e.target.checked)}
          />{" "}
          Landscape
        </label>
      </div>
      {preset === "custom" && (
        <div className="field-row">
          <label>
            Width{" "}
            <input
              className="num-input"
              aria-label="Width"
              value={custom.w}
              onChange={(e) => setCustom({ ...custom, w: e.target.value })}
            />{" "}
            in
          </label>
          <label>
            Height{" "}
            <input
              className="num-input"
              aria-label="Height"
              value={custom.h}
              onChange={(e) => setCustom({ ...custom, h: e.target.value })}
            />{" "}
            in
          </label>
        </div>
      )}
      <p className="muted small">Content and markup are scaled to fit, centred.</p>
      {scope.ui}
      <ErrorText text={err} />
    </FormModal>
  );
}

type SplitMethod = "count" | "ranges" | "bookmarks" | "size";

function SplitDialog({ documentId, pageCount, onClose }: OpProps) {
  const wb = useWorkbench();
  const m = wb.meta[documentId];
  const [method, setMethod] = useState<SplitMethod>("count");
  const [count, setCount] = useState("1");
  const [ranges, setRanges] = useState("");
  const [mb, setMb] = useState("10");
  const [folder, setFolder] = useState<string | null>(
    m?.source.kind === "path" ? dirName(m.source.path) : null,
  );
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);
  const stem = titleFromFileName(m?.name ?? "Document");

  const run = async () => {
    setErr(null);
    const bytes = await wb.docBytes(documentId);
    if (!bytes) return;
    if (!folder) {
      setErr("Choose a folder for the new files.");
      return;
    }
    setWorking(true);
    try {
      let parts: SplitResult[];
      if (method === "size") {
        const max = Number(mb) * 1024 * 1024;
        if (!(max > 0)) throw new RangeError("enter a size in MB");
        parts = await pageOp("splitBySize", bytes, max);
      } else {
        const plan =
          method === "count"
            ? partsByCount(pageCount, Number(count))
            : method === "ranges"
              ? ranges
                  .split(";")
                  .map((r) => r.trim())
                  .filter(Boolean)
                  .map((r, i) => ({ label: `Part ${i + 1}`, pages: parseRanges(r, pageCount) }))
              : partsByBookmarks(await pageOp("readOutline", bytes), pageCount);
        if (!plan.length) throw new RangeError("enter at least one page range");
        parts = await pageOp("splitParts", bytes, plan);
      }
      const written: string[] = [];
      for (const p of parts) {
        const name = `${safeFileName(`${stem} - ${p.label}`)}.pdf`;
        written.push(await platform.writeNewFile(folder, name, p.bytes));
      }
      setDone(written);
      const big = parts.filter((p) => p.oversize).length;
      wb.toast(
        `Split into ${parts.length} files.` +
          (big ? ` ${big} single page(s) are larger than the limit on their own.` : ""),
      );
    } catch (e) {
      setErr(message(e));
    } finally {
      setWorking(false);
    }
  };

  if (done) {
    return (
      <FormModal title="Split document" submit="Done" onClose={onClose} onSubmit={onClose}>
        <p>Created {done.length} files:</p>
        <ul className="file-list" data-testid="split-results">
          {done.map((p) => (
            <li key={p}>{baseName(p)}</li>
          ))}
        </ul>
        <p className="muted small">in {folder}</p>
      </FormModal>
    );
  }
  const radio = (v: SplitMethod, label: string, extra?: ReactNode) => (
    <label className="split-method">
      <input type="radio" name="split" checked={method === v} onChange={() => setMethod(v)} />{" "}
      {label} {extra}
    </label>
  );
  return (
    <FormModal
      title="Split document"
      submit="Split"
      onClose={onClose}
      onSubmit={run}
      busy={working}
    >
      <fieldset>
        <legend>Split by</legend>
        {radio(
          "count",
          "Number of pages per file",
          <input
            className="num-input"
            aria-label="Pages per file"
            value={count}
            onFocus={() => setMethod("count")}
            onChange={(e) => setCount(e.target.value)}
          />,
        )}
        {radio(
          "ranges",
          "Page ranges (one file each, separated by ;)",
          <input
            className="range-input"
            aria-label="Page ranges"
            value={ranges}
            placeholder="1-3; 4-10; 11-z"
            onFocus={() => setMethod("ranges")}
            onChange={(e) => setRanges(e.target.value)}
          />,
        )}
        {radio("bookmarks", "Top-level bookmarks (named after each bookmark)")}
        {radio(
          "size",
          "Maximum file size",
          <>
            <input
              className="num-input"
              aria-label="Maximum size in MB"
              value={mb}
              onFocus={() => setMethod("size")}
              onChange={(e) => setMb(e.target.value)}
            />{" "}
            MB
          </>,
        )}
      </fieldset>
      <div className="field-row">
        <button
          type="button"
          onClick={() => void platform.pickFolder().then((f) => f && setFolder(f))}
        >
          Output folder…
        </button>
        <span className="path" data-testid="split-folder">
          {folder ?? "Not chosen"}
        </span>
      </div>
      <p className="muted small">
        Files are named “{stem} - Part 1.pdf” and so on. Existing files are never overwritten.
      </p>
      {working && <p role="status">Splitting…</p>}
      <ErrorText text={err} />
    </FormModal>
  );
}

interface CombineItem {
  key: number;
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  range: string;
}

let combineKey = 0;

export function CombineDialog({
  startWith,
  onClose,
}: {
  /** The document open when Combine was chosen: it starts the list (remove it if unwanted). */
  startWith: string | null;
  onClose: () => void;
}) {
  const wb = useWorkbench();
  const [items, setItems] = useState<CombineItem[]>([]);
  const [perFile, setPerFile] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  // Drag rows to reorder (pointer events; see usePointerDrag).
  const rowAt = (under: Element | null) => {
    const v = under?.closest<HTMLElement>("[data-row]")?.dataset.row;
    return v === undefined ? null : Number(v);
  };
  const drag = usePointerDrag<number>({
    onMove: () => undefined,
    onCancel: () => undefined,
    onDrop: (from, under) => {
      const to = rowAt(under);
      if (to !== null && to !== from) moveItem(from, to);
    },
  });

  const add = async (files: OpenedFile[]) => {
    const added: CombineItem[] = [];
    const failed: string[] = [];
    for (const f of files) {
      try {
        const pdf = await asPdf([f]);
        added.push({
          key: ++combineKey,
          name: f.name,
          bytes: pdf.bytes,
          pageCount: await pageOp("pageCount", pdf.bytes),
          range: "",
        });
      } catch {
        failed.push(f.name);
      }
    }
    setItems((cur) => [...cur, ...added]);
    setErr(failed.length ? `Could not read: ${failed.join(", ")}` : null);
  };

  const addFolder = async () => {
    const folder = await platform.pickFolder();
    if (!folder) return;
    setWorking("Reading folder…");
    try {
      const paths = await platform.listFolder(folder);
      const files: OpenedFile[] = [];
      for (const p of paths) files.push(await platform.readPath(p));
      await add(files);
      if (!paths.length) setErr("That folder has no PDF or image files.");
    } catch (e) {
      setErr(message(e));
    } finally {
      setWorking(null);
    }
  };

  const started = useRef(false);
  useEffect(() => {
    if (started.current || !startWith) return;
    started.current = true;
    const m = wb.meta[startWith];
    if (!m) return;
    // Reading the bytes and page count is async; the list updates when they arrive.
    void wb.docBytes(startWith).then((bytes) => {
      if (bytes) void add([{ source: m.source, name: m.name, bytes: bytes.slice().buffer }]);
    });
    // Once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addOpen = async () => {
    const files: OpenedFile[] = [];
    for (const id of Object.keys(wb.meta)) {
      const bytes = await wb.docBytes(id);
      const m = wb.meta[id];
      if (bytes && m) files.push({ source: m.source, name: m.name, bytes: bytes.slice().buffer });
    }
    void add(files);
  };

  const moveItem = (from: number, to: number) =>
    setItems((cur) => {
      const next = [...cur];
      const [it] = next.splice(from, 1);
      if (it) next.splice(Math.max(0, Math.min(next.length, to)), 0, it);
      return next;
    });

  const total = useMemo(
    () =>
      items.reduce((n, it) => {
        try {
          return n + parseRanges(it.range, it.pageCount).length;
        } catch {
          return n;
        }
      }, 0),
    [items],
  );

  const combine = async () => {
    setErr(null);
    try {
      if (!items.length) throw new RangeError("Add files to combine.");
      const sources = items.map((it) => ({
        name: it.name,
        bytes: it.bytes,
        pages: parseRanges(it.range, it.pageCount),
      }));
      setWorking("Combining…");
      const out = await pageOp("combine", sources, { bookmarkPerFile: perFile });
      onClose();
      wb.openNew("Combined.pdf", out);
    } catch (e) {
      setErr(`${message(e)}`);
    } finally {
      setWorking(null);
    }
  };

  return (
    <FormModal
      title="Combine Files"
      submit="Combine"
      onSubmit={combine}
      onClose={onClose}
      busy={working !== null || !items.length}
      wide
    >
      <div className="button-row inline">
        <button type="button" onClick={() => void platform.pickFiles({ images: true }).then(add)}>
          Add files…
        </button>
        <button type="button" onClick={() => void addFolder()}>
          Add folder…
        </button>
        <button
          type="button"
          onClick={() => void addOpen()}
          disabled={!Object.keys(wb.meta).length}
        >
          Add open files
        </button>
      </div>
      <table className="combine-list" aria-label="Files to combine">
        <thead>
          <tr>
            <th>#</th>
            <th>File</th>
            <th>Pages</th>
            <th>Page range</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr
              key={it.key}
              data-testid="combine-item"
              data-row={i}
              className={drag.source === i ? "dragging" : undefined}
              onPointerDown={(e) => drag.start(e, i)}
            >
              <td>{i + 1}</td>
              <td className="combine-name">{it.name}</td>
              <td>{it.pageCount}</td>
              <td>
                <input
                  className="range-input"
                  aria-label={`Page range for ${it.name}`}
                  placeholder="All"
                  value={it.range}
                  onChange={(e) =>
                    setItems((cur) =>
                      cur.map((x) => (x.key === it.key ? { ...x, range: e.target.value } : x)),
                    )
                  }
                />
              </td>
              <td className="row-actions">
                <button
                  type="button"
                  aria-label={`Move ${it.name} up`}
                  disabled={i === 0}
                  onClick={() => moveItem(i, i - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${it.name} down`}
                  disabled={i === items.length - 1}
                  onClick={() => moveItem(i, i + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${it.name}`}
                  onClick={() => setItems((cur) => cur.filter((x) => x.key !== it.key))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
          {!items.length && (
            <tr>
              <td colSpan={5} className="muted">
                Add PDFs or images (JPG, PNG, TIFF). Drag rows to reorder.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="field-row">
        <label>
          <input type="checkbox" checked={perFile} onChange={(e) => setPerFile(e.target.checked)} />{" "}
          Add a bookmark for each file (named after the file)
        </label>
        <span className="grow" />
        <span className="muted small">{total} pages</span>
      </div>
      <p className="muted small">
        Form fields with the same name in different files are renamed (e.g. “name” becomes “name+1”)
        so their values stay separate.
      </p>
      {working && <p role="status">{working}</p>}
      <ErrorText text={err} />
    </FormModal>
  );
}

export function UnsavedDialog({
  documentIds,
  then,
  onClose,
}: {
  documentIds: string[];
  then: "close" | "closeAll" | "closeWindow";
  onClose: () => void;
}) {
  const wb = useWorkbench();
  const names = documentIds.map((id) => wb.meta[id]?.name ?? "Untitled");
  const finish = () => {
    onClose();
    if (then === "close") wb.forceClose(documentIds);
    else wb.forceClose(Object.keys(wb.meta));
    if (then === "closeWindow") void platform.windows?.closeWindow();
  };
  return (
    <FormModal
      title="Unsaved changes"
      submit={documentIds.length === 1 ? "Save" : "Save all"}
      onClose={onClose}
      onSubmit={async () => {
        for (const id of documentIds) if (!(await wb.save(id))) return;
        finish();
      }}
    >
      <p>
        Save changes to {names.length === 1 ? `“${names[0]}”` : `${names.length} documents`} before
        closing?
      </p>
      {names.length > 1 && (
        <ul className="file-list">
          {names.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      <div className="button-row inline">
        <button type="button" className="danger" onClick={finish}>
          Don’t save
        </button>
      </div>
    </FormModal>
  );
}

/** Ctrl+Q with unsaved documents: one prompt for every window (backlog B1). */
export function QuitDialog({ docs, onClose }: { docs: DocInfo[]; onClose: () => void }) {
  const wb = useWorkbench();
  return (
    <FormModal
      title="Unsaved changes"
      submit={docs.length === 1 ? "Save and quit" : "Save all and quit"}
      onClose={onClose}
      onSubmit={async () => {
        await wb.finishQuit(docs, true);
        onClose();
      }}
    >
      <p>
        {docs.length === 1
          ? "This document has unsaved changes:"
          : `${docs.length} documents have unsaved changes:`}
      </p>
      <ul className="file-list" data-testid="quit-list">
        {docs.map((d) => (
          <li key={d.id}>{d.path ?? d.name}</li>
        ))}
      </ul>
      <div className="button-row inline">
        <button type="button" className="danger" onClick={() => void wb.finishQuit(docs, false)}>
          Quit without saving
        </button>
      </div>
    </FormModal>
  );
}

export function ConfirmDialog({ req }: { req: ConfirmRequest }) {
  return (
    <FormModal
      title={req.title}
      submit={req.ok}
      danger={req.danger ?? false}
      onClose={() => req.resolve(false)}
      onSubmit={() => req.resolve(true)}
    >
      <p data-testid="confirm-message">{req.message}</p>
    </FormModal>
  );
}
