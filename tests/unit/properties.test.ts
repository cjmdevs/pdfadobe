import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENCRYPTED_PASSWORDS, OUT_DIR } from "../corpus/generate.mjs";
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import type { Engine } from "../../src/engine/pdfium";
import {
  decodePermissions,
  documentProperties,
  formatFileSize,
  formatPageSize,
  isLinearized,
  pdfHeaderVersion,
} from "../../src/engine/properties";

let engine: Engine;
beforeAll(async () => {
  engine = await nodeEngine();
});
afterAll(async () => {
  await engine.closeAllDocuments().toPromise();
});

async function open(name: string, password?: string) {
  const bytes = new Uint8Array(readFileSync(join(OUT_DIR, name)));
  const doc = await engine
    .openDocumentBuffer(
      { id: `${name}-${Math.random()}`, content: toArrayBuffer(bytes) },
      password ? { password } : {},
    )
    .toPromise();
  return { doc, bytes };
}

describe("document properties", () => {
  it("reads metadata, version, and size from a plain file", async () => {
    const { doc, bytes } = await open("navigation.pdf");
    const p = await documentProperties(engine, doc, bytes);
    expect(p.title).toBe("Synthetic navigation fixture");
    expect(p.author).toBe("PDF Workbench test corpus");
    expect(p.subject).toBe("Outline, attachments, mixed page sizes");
    expect(p.pdfVersion).toBe("1.7");
    expect(p.pageCount).toBe(8);
    expect(p.encrypted).toBe(false);
    expect(Object.values(p.permissions).every(Boolean)).toBe(true);
    expect(p.creationDate?.toISOString()).toBe("2025-01-15T12:00:00.000Z");
  });

  it("reports encryption on the AES-256 file", async () => {
    const { doc, bytes } = await open("encrypted.pdf", ENCRYPTED_PASSWORDS.user);
    const p = await documentProperties(engine, doc, bytes);
    expect(p.encrypted).toBe(true);
    // qpdf --encrypt defaults allow everything; still encrypted, so flags are read.
    expect(p.permissions.print).toBe(true);
  });

  it("decodes restricted permission flags", () => {
    const p = decodePermissions(4 | 16, true);
    expect(p.print).toBe(true);
    expect(p.copyContents).toBe(true);
    expect(p.modifyContents).toBe(false);
    expect(p.fillForms).toBe(false);
  });

  it("parses headers and linearization", () => {
    const enc = new TextEncoder();
    expect(pdfHeaderVersion(enc.encode("%PDF-2.0\n"))).toBe("2.0");
    expect(pdfHeaderVersion(enc.encode("junk\n%PDF-1.4\n"))).toBe("1.4");
    expect(pdfHeaderVersion(enc.encode("not a pdf"))).toBeNull();
    expect(isLinearized(enc.encode("%PDF-1.7\n1 0 obj <</Linearized 1/L 100>>"))).toBe(true);
    expect(isLinearized(enc.encode("%PDF-1.7\n1 0 obj <</Type/Catalog>>"))).toBe(false);
  });

  it("names common paper sizes in either orientation", () => {
    expect(formatPageSize(612, 792)).toBe("8.50 x 11.00 in (Letter)");
    expect(formatPageSize(792, 612)).toBe("11.00 x 8.50 in (Letter)");
    expect(formatPageSize(595.28, 841.89)).toBe("8.27 x 11.69 in (A4)");
    expect(formatPageSize(500, 500)).toBe("6.94 x 6.94 in");
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });
});
