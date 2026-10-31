// Phase 8: certificate signing. A signed file verifies (our check and OpenSSL's), keeps
// the original as an exact prefix when it was already signed, reports later changes,
// and a changed byte breaks the signature. Writes tests/corpus/out/signed-*.pdf for
// the owner's Acrobat check.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR } from "../corpus/generate.mjs";
import { nodeQpdf } from "../helpers/qpdf-node";
import { testIdentity, type TestIdentity } from "../helpers/test-signer";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import { PdfObjects } from "../../src/engine/redact/objects";
import {
  drawFillMark,
  drawSignatureMark,
  drawTextMark,
  emptySignatureFields,
  frameOf,
  listSignatures,
  signPdf,
  SignError,
} from "../../src/engine/sign";
import { pageFrames } from "../../src/engine/pages/graft";
import { PDFDocument, degrees } from "pdf-lib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const qpdf = nodeQpdf();
const corpus = (f: string) => new Uint8Array(readFileSync(join(OUT_DIR, f)));
const SPIKE_DIR = join(OUT_DIR, "..", "out");
let m: PdfiumModule;
let id: TestIdentity;

beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
  id = await testIdentity();
});

function openssl(): string | null {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return "openssl";
  } catch {
    return null;
  }
}

/** OpenSSL's own verdict on signature `n` (0-based): digest and signature, no chain. */
function opensslVerifies(signed: Uint8Array, n = 0): boolean {
  const text = new TextDecoder("latin1").decode(signed);
  const ranges = [...text.matchAll(/\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\s*\]/g)].map((x) =>
    x.slice(1, 5).map(Number),
  );
  const [, b, c, d] = ranges[n]!;
  const dir = mkdtempSync(join(tmpdir(), "pdfwb-sign-"));
  try {
    const content = Buffer.concat([signed.subarray(0, b!), signed.subarray(c!, c! + d!)]);
    const padded = Buffer.from(text.slice(b! + 1, c! - 1), "hex");
    const n = padded[1]! & 0x7f; // long-form length: 0x30 0x8n <n bytes>
    const der = padded.subarray(0, 2 + n + padded.readUIntBE(2, n));
    writeFileSync(join(dir, "content.bin"), content);
    writeFileSync(join(dir, "sig.der"), der);
    execFileSync(
      "openssl",
      [
        "cms",
        "-verify",
        "-binary",
        "-inform",
        "DER",
        "-noverify",
        "-purpose",
        "any",
        "-in",
        join(dir, "sig.der"),
        "-content",
        join(dir, "content.bin"),
        "-out",
        join(dir, "o.bin"),
      ],
      { stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function qpdfCheck(bytes: Uint8Array): void {
  const dir = mkdtempSync(join(tmpdir(), "pdfwb-sign-"));
  try {
    writeFileSync(join(dir, "s.pdf"), bytes);
    execFileSync(qpdfBinPath(), ["--check", join(dir, "s.pdf")], { stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const qpdfBinPath = () =>
  join(OUT_DIR, "..", "..", "..", "src-tauri", "vendor", "qpdf", "qpdf.exe");

function pdfiumSignatureCount(bytes: Uint8Array): number {
  const doc = RawDoc.open(m, bytes);
  try {
    return m.FPDF_GetSignatureCount(doc.ptr);
  } finally {
    doc.close();
  }
}

describe("certificate signing", () => {
  it("signs invisibly; the signature verifies and covers the whole file", async () => {
    const out = await signPdf(qpdf, corpus("text-1p.pdf"), {
      signer: id.signer,
      reason: "I approve this document",
      location: "Office",
    });
    const sigs = await listSignatures(out);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({
      signer: "PDF Workbench Test Signer",
      reason: "I approve this document",
      location: "Office",
      subFilter: "ETSI.CAdES.detached",
      intact: true,
      changedAfter: false,
      problem: null,
    });
    expect(pdfiumSignatureCount(out)).toBe(1);
    qpdfCheck(out);
    if (openssl()) expect(opensslVerifies(out)).toBe(true);
  });

  it("signs visibly with an image, on a rotated page too", async () => {
    const img = { width: 2, height: 1, data: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0]) };
    for (const file of ["text-1p.pdf", "scanned-sideways.pdf"]) {
      const out = await signPdf(qpdf, corpus(file), {
        signer: id.signer,
        box: { page: 0, rect: { x: 72, y: 72, width: 240, height: 60 } },
        reason: "Reviewed",
        appearance: { image: img },
      });
      const objs = await PdfObjects.read(qpdf, out);
      const widget = Object.values(
        Object.fromEntries(objs.refs().map((r) => [r, objs.dict(r)])),
      ).find((d) => d?.["/FT"] === "/Sig");
      expect(widget?.["/Rect"]).toBeDefined();
      expect((await listSignatures(out))[0]?.intact).toBe(true);
      qpdfCheck(out);
    }
  });

  it("fills an existing empty signature field", async () => {
    const src = corpus("sign-field.pdf");
    expect(emptySignatureFields(await PdfObjects.read(qpdf, src))).toEqual(["Client Signature"]);
    const out = await signPdf(qpdf, src, { signer: id.signer, field: "Client Signature" });
    expect(emptySignatureFields(await PdfObjects.read(qpdf, out))).toEqual([]);
    expect((await listSignatures(out))[0]?.intact).toBe(true);
    await expect(
      signPdf(qpdf, out, { signer: id.signer, field: "Client Signature" }),
    ).rejects.toThrow(/already signed/);
  });

  it("a second signature appends: the first stays valid and reports the later change", async () => {
    const once = await signPdf(qpdf, corpus("text-1p.pdf"), { signer: id.signer });
    const other = await testIdentity("Second Signer", "ec");
    const twice = await signPdf(qpdf, once, {
      signer: other.signer,
      box: { page: 0, rect: { x: 300, y: 72, width: 200, height: 50 } },
    });
    expect(Buffer.from(twice.subarray(0, once.length)).equals(Buffer.from(once))).toBe(true);
    const sigs = await listSignatures(twice);
    expect(sigs.map((s) => [s.signer, s.intact, s.changedAfter])).toEqual([
      ["PDF Workbench Test Signer", true, true],
      ["Second Signer", true, false],
    ]);
    if (openssl()) expect(opensslVerifies(twice, 1)).toBe(true);
    qpdfCheck(twice);
  });

  it("a changed byte inside the signed range breaks the signature", async () => {
    const out = await signPdf(qpdf, corpus("text-1p.pdf"), { signer: id.signer });
    const bad = out.slice();
    bad[200] = (bad[200]! + 1) & 255;
    const [sig] = await listSignatures(bad);
    expect(sig?.intact).toBe(false);
    expect(sig?.problem).toBeTruthy();
  });

  it("refuses a password-protected file", async () => {
    await expect(signPdf(qpdf, corpus("encrypted.pdf"), { signer: id.signer })).rejects.toThrow(
      SignError,
    );
  });

  it("page frames from qpdf's objects match PDFium's (rotation, crop box)", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).setRotation(degrees(90));
    const p2 = doc.addPage([500, 400]);
    p2.setCropBox(20, 30, 300, 200);
    p2.setRotation(degrees(270));
    doc.addPage([300, 300]).setRotation(degrees(180));
    const bytes = await doc.save();
    const objs = await PdfObjects.read(qpdf, bytes);
    expect(objs.pages().map((p) => frameOf(objs, p))).toEqual(pageFrames(m, bytes));
  });

  it("draws Fill & Sign marks as one-page PDFs", async () => {
    for (const k of ["check", "cross", "dot"] as const) {
      const d = await drawFillMark(k);
      expect(d.width).toBe(14);
      expect((await PDFDocument.load(d.pdf)).getPageCount()).toBe(1);
    }
    expect((await drawTextMark("10/31/2026")).width).toBeGreaterThan(40);
    const png = new Uint8Array(readFileSync(join(OUT_DIR, "stamp-reviewed.png")));
    const sig = await drawSignatureMark(png, 120, 40, "10/31/2026");
    expect(sig.height).toBeGreaterThan(40);
  });

  it("writes the Acrobat check files", async () => {
    mkdirSync(SPIKE_DIR, { recursive: true });
    const visible = await signPdf(qpdf, corpus("text-1p.pdf"), {
      signer: id.signer,
      box: { page: 0, rect: { x: 72, y: 450, width: 260, height: 70 } },
      reason: "I approve this document",
      location: "Test office",
    });
    writeFileSync(join(SPIKE_DIR, "signed-visible.pdf"), visible);
    writeFileSync(
      join(SPIKE_DIR, "signed-field.pdf"),
      await signPdf(qpdf, corpus("sign-field.pdf"), {
        signer: id.signer,
        field: "Client Signature",
      }),
    );
    writeFileSync(join(SPIKE_DIR, "signed-test-cert.cer"), id.certDer);
    expect(visible.length).toBeGreaterThan(0);
  });
});
