// THROWAWAY Phase 0 spike route (#/spike). Not the real UI.
// Exercises: native open dialog -> Rust read -> EmbedPDF render; stamp + free text;
// redaction; Save As via native dialog -> Rust atomic write.
// Outside Tauri (plain browser / Playwright) it falls back to <input type=file> + download.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PdfDocumentObject } from "@embedpdf/models";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import stampUrl from "./stamp-reviewed.png?url";
import { createEngine, type Engine } from "../engine/pdfium";
import { addFreeText, addImageStamp, redact, save } from "../engine/spike";
import { isTauri, openPdfNative, savePdfNative } from "./tauri-io";

const DEFAULT_NEEDLE = "000-12-3456";

export default function SpikePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [doc, setDoc] = useState<PdfDocumentObject | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [needle, setNeedle] = useState(DEFAULT_NEEDLE);
  const [status, setStatus] = useState("Loading PDFium…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const wasm = await (await fetch(wasmUrl)).arrayBuffer();
      const engine = await createEngine(wasm);
      if (!cancelled) {
        engineRef.current = engine;
        setStatus(`PDFium ready. ${isTauri() ? "Tauri" : "Browser"} mode.`);
      }
    })().catch((e: unknown) => setStatus(`Engine failed: ${String(e)}`));
    return () => {
      cancelled = true;
    };
  }, []);

  const render = useCallback(async (d: PdfDocumentObject, index: number) => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    const page = d.pages[index];
    if (!engine || !canvas || !page) return;
    const img = await engine
      .renderPageRaw(d, page, {
        scaleFactor: 1.5 * window.devicePixelRatio,
        withAnnotations: true,
        withForms: true,
      })
      .toPromise();
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.style.width = `${img.width / window.devicePixelRatio}px`;
    canvas.getContext("2d")?.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  }, []);

  const run = async (label: string, fn: (engine: Engine) => Promise<string>) => {
    const engine = engineRef.current;
    if (!engine) return;
    setBusy(true);
    try {
      setStatus(await fn(engine));
    } catch (e) {
      // Error text only: never document contents.
      setStatus(`${label} failed: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const loadBytes = async (engine: Engine, bytes: ArrayBuffer, path: string | null) => {
    if (doc) await engine.closeDocument(doc).toPromise();
    const d = await engine
      .openDocumentBuffer({ id: crypto.randomUUID(), content: bytes })
      .toPromise();
    setDoc(d);
    setSourcePath(path);
    setPageIndex(0);
    await render(d, 0);
    return `Opened ${d.pageCount} page(s)${path ? ` from ${path}` : ""}.`;
  };

  const onOpenNative = () =>
    run("Open", async (engine) => {
      const picked = await openPdfNative();
      if (!picked) return "Open cancelled.";
      return loadBytes(engine, picked.bytes, picked.path);
    });

  const onOpenFile = (file: File) =>
    run("Open", async (engine) => loadBytes(engine, await file.arrayBuffer(), file.name));

  const onAnnotate = () =>
    run("Annotate", async (engine) => {
      if (!doc) return "Open a PDF first.";
      const png = await (await fetch(stampUrl)).arrayBuffer();
      const w = doc.pages[pageIndex]?.size.width ?? 612;
      await addImageStamp(
        engine,
        doc,
        pageIndex,
        { origin: { x: w - 222, y: 36 }, size: { width: 150, height: 50 } },
        png,
      );
      await addFreeText(
        engine,
        doc,
        pageIndex,
        { origin: { x: 72, y: 100 }, size: { width: 300, height: 40 } },
        "Spike note: tied to TB. Ref W/P A-1.",
      );
      await render(doc, pageIndex);
      return "Added image stamp + free text. Use Save As.";
    });

  const onRedact = () =>
    run("Redact", async (engine) => {
      if (!doc) return "Open a PDF first.";
      const { marked, pagesChanged } = await redact(engine, doc, { needle });
      await render(doc, pageIndex);
      return `Marked ${marked} redaction(s); applied on ${pagesChanged.length} page(s). Use Save As.`;
    });

  const onSaveAs = () =>
    run("Save As", async (engine) => {
      if (!doc) return "Open a PDF first.";
      const bytes = await save(engine, doc);
      if (isTauri()) {
        const target = await savePdfNative(bytes, sourcePath);
        return target ? `Saved to ${target}` : "Save cancelled.";
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      a.download = "spike-output.pdf";
      a.click();
      URL.revokeObjectURL(a.href);
      return "Downloaded spike-output.pdf";
    });

  const go = (delta: number) => {
    if (!doc) return;
    const next = Math.min(doc.pageCount - 1, Math.max(0, pageIndex + delta));
    setPageIndex(next);
    void render(doc, next);
  };

  return (
    <main style={{ fontFamily: "system-ui", padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>Phase 0 spike (throwaway)</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {isTauri() ? (
          <button onClick={onOpenNative} disabled={busy}>
            Open…
          </button>
        ) : (
          <input
            type="file"
            accept="application/pdf"
            aria-label="Open PDF"
            onChange={(e) => e.target.files?.[0] && onOpenFile(e.target.files[0])}
          />
        )}
        <button onClick={onAnnotate} disabled={busy || !doc}>
          Add stamp + free text
        </button>
        <label>
          Redact text <input value={needle} onChange={(e) => setNeedle(e.target.value)} size={14} />
        </label>
        <button onClick={onRedact} disabled={busy || !doc || !needle}>
          Mark + apply redaction
        </button>
        <button onClick={onSaveAs} disabled={busy || !doc}>
          Save As…
        </button>
        <button onClick={() => go(-1)} disabled={!doc || pageIndex === 0}>
          ◀
        </button>
        <span>{doc ? `Page ${pageIndex + 1} / ${doc.pageCount}` : "No document"}</span>
        <button onClick={() => go(1)} disabled={!doc || pageIndex >= (doc?.pageCount ?? 1) - 1}>
          ▶
        </button>
      </div>
      <p role="status" data-testid="status">
        {status}
      </p>
      <canvas ref={canvasRef} data-testid="page" style={{ border: "1px solid #ccc" }} />
    </main>
  );
}
