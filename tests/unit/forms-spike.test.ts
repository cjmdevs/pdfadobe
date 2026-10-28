// Phase 6 pre-check (spike). (a) Can EmbedPDF/PDFium create new AcroForm fields that an
// independent parser (qpdf, pdf.js) sees as real fields? (b) Do calculated fields that
// rely on PDF JavaScript update when an input changes through PDFium's form-fill path?
// Findings: docs/forms-spike-report.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PDF_FORM_FIELD_FLAG,
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  PdfStandardFont,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfWidgetAnnoObject,
} from "@embedpdf/models";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR } from "../corpus/generate.mjs";
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import { execFileSync } from "node:child_process";
import { qpdfBin } from "../corpus/generate.mjs";
import type { Engine } from "../../src/engine/pdfium";

const OUT = join(OUT_DIR, "..", "out", "forms-spike");
let engine: Engine;

beforeAll(async () => {
  engine = await nodeEngine();
  mkdirSync(OUT, { recursive: true });
});

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  return engine.openDocumentBuffer({ id: crypto.randomUUID(), content: toArrayBuffer(bytes) }).toPromise();
}

async function widgets(doc: PdfDocumentObject, page = 0): Promise<PdfWidgetAnnoObject[]> {
  const all: PdfAnnotationObject[] = await engine
    .getPageAnnotations(doc, doc.pages[page]!)
    .toPromise();
  return all.filter((a): a is PdfWidgetAnnoObject => a.type === PdfAnnotationSubtype.WIDGET);
}

function widget(
  name: string,
  field: Partial<PdfWidgetAnnoObject["field"]> & { type: PDF_FORM_FIELD_TYPE },
  rect: { x: number; y: number; w: number; h: number },
): PdfWidgetAnnoObject {
  return {
    type: PdfAnnotationSubtype.WIDGET,
    id: crypto.randomUUID(),
    pageIndex: 0,
    rect: { origin: { x: rect.x, y: rect.y }, size: { width: rect.w, height: rect.h } },
    field: {
      flag: PDF_FORM_FIELD_FLAG.NONE,
      name,
      alternateName: "",
      value: "",
      ...field,
    } as PdfWidgetAnnoObject["field"],
    fontFamily: PdfStandardFont.Helvetica,
    fontSize: 10,
    fontColor: "#000000",
    color: "#ffffff",
    strokeColor: "#000000",
  } as unknown as PdfWidgetAnnoObject;
}

describe("(a) create AcroForm fields on a flat PDF", () => {
  let saved: Uint8Array;
  const results: Record<string, string> = {};

  beforeAll(async () => {
    const doc = await open(new Uint8Array(readFileSync(join(OUT_DIR, "text-1p.pdf"))));
    const page = doc.pages[0]!;
    const specs: [string, PdfWidgetAnnoObject][] = [
      [
        "text",
        widget(
          "spike.text",
          { type: PDF_FORM_FIELD_TYPE.TEXTFIELD, value: "Hello", maxLen: 20 },
          { x: 72, y: 100, w: 200, h: 20 },
        ),
      ],
      [
        "checkbox",
        widget(
          "spike.check",
          { type: PDF_FORM_FIELD_TYPE.CHECKBOX },
          { x: 72, y: 140, w: 14, h: 14 },
        ),
      ],
      [
        "radio",
        widget(
          "spike.radio",
          {
            type: PDF_FORM_FIELD_TYPE.RADIOBUTTON,
            options: [{ label: "A", isSelected: false }],
          },
          { x: 72, y: 170, w: 14, h: 14 },
        ),
      ],
      [
        "combobox",
        widget(
          "spike.combo",
          {
            type: PDF_FORM_FIELD_TYPE.COMBOBOX,
            options: [
              { label: "One", isSelected: true },
              { label: "Two", isSelected: false },
            ],
          },
          { x: 72, y: 200, w: 120, h: 20 },
        ),
      ],
      [
        "signature",
        widget(
          "spike.sig",
          { type: PDF_FORM_FIELD_TYPE.SIGNATURE },
          { x: 72, y: 240, w: 200, h: 40 },
        ),
      ],
    ];
    for (const [key, w] of specs) {
      try {
        await engine.createPageAnnotation(doc, page, w).toPromise();
        results[key] = "created";
      } catch (e) {
        results[key] = `FAILED: ${JSON.stringify(e)}`;
      }
    }
    saved = new Uint8Array(await engine.saveAsCopy(doc).toPromise());
    await engine.closeDocument(doc).toPromise();
    writeFileSync(join(OUT, "created-fields.pdf"), saved);
    writeFileSync(join(OUT, "created-results.json"), JSON.stringify(results, null, 2));
  });

  it("reports what PDFium created", () => {
    console.log("create results", results);
    expect(Object.keys(results)).toHaveLength(5);
  });

  it("qpdf sees them in /AcroForm /Fields with /FT and an appearance", async () => {
    const json = JSON.parse(
      execFileSync(
        qpdfBin(),
        ["--json=2", "--json-key=acroform", join(OUT, "created-fields.pdf")],
        {
          encoding: "utf8",
        },
      ),
    ) as { acroform: { fields: { fullname: string; fieldtype: string; value: unknown }[] } };
    const fields = json.acroform.fields.map((f) => `${f.fullname}:${f.fieldtype}`);
    console.log("qpdf fields", fields);
    writeFileSync(join(OUT, "qpdf-fields.json"), JSON.stringify(json.acroform, null, 2));
    expect(fields.length).toBeGreaterThan(0);
  });

  it("pdf.js sees them as form fields", async () => {
    const pdf = await getDocument({ data: saved.slice() }).promise;
    const objs = (await pdf.getFieldObjects()) ?? {};
    const summary = [...(objs instanceof Map ? objs : new Map(Object.entries(objs)))].map(
      ([k, v]) => `${k}:${(v as { type: string }[])[0]?.type}`,
    );
    console.log("pdf.js fields", summary);
    expect(summary.length).toBeGreaterThan(0);
  });

  it("PDFium reads them back on reopen", async () => {
    const doc = await open(saved);
    const ws = await widgets(doc);
    console.log(
      "reopen",
      ws.map((w) => `${w.field.name}:${w.field.type}:${w.field.value}`),
    );
    await engine.closeDocument(doc).toPromise();
    expect(ws.length).toBeGreaterThan(0);
  });
});

describe("(b) JavaScript calculated fields", () => {
  let calcPdf: Uint8Array;

  beforeAll(async () => {
    // Three text fields; Total has the Acrobat built-in AFSimple_Calculate in /AA /C and
    // sits in /AcroForm /CO, exactly how Acrobat and IRS forms store a calculated field.
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const form = pdf.getForm();
    for (const [name, y] of [
      ["A", 700],
      ["B", 660],
      ["Total", 620],
    ] as const) {
      form.createTextField(name).addToPage(page, { x: 72, y, width: 120, height: 20 });
    }
    const total = form.getTextField("Total");
    const js = pdf.context.obj({
      S: PDFName.of("JavaScript"),
      JS: PDFString.of('AFSimple_Calculate("SUM", new Array("A", "B"));'),
    });
    total.acroField.dict.set(PDFName.of("AA"), pdf.context.obj({ C: js }));
    form.acroForm.dict.set(PDFName.of("CO"), pdf.context.obj([total.acroField.ref]));
    calcPdf = await pdf.save({ updateFieldAppearances: true });
    writeFileSync(join(OUT, "calc.pdf"), calcPdf);
  });

  it("Total updates after A and B are typed through the form-fill path", async () => {
    const doc = await open(calcPdf);
    const page = doc.pages[0]!;
    const before = await widgets(doc);
    const byName = (ws: PdfWidgetAnnoObject[], n: string) => ws.find((w) => w.field.name === n)!;
    await engine
      .setFormFieldValue(doc, page, byName(before, "A"), { kind: "text", text: "2" })
      .toPromise();
    await engine
      .setFormFieldValue(doc, page, byName(before, "B"), { kind: "text", text: "3" })
      .toPromise();
    const after = await widgets(doc);
    const total = byName(after, "Total").field.value;
    console.log("calc: A=2 B=3 -> Total =", JSON.stringify(total));
    const saved = new Uint8Array(await engine.saveAsCopy(doc).toPromise());
    writeFileSync(join(OUT, "calc-filled.pdf"), saved);
    await engine.closeDocument(doc).toPromise();
    // Recorded, not asserted: the report states the observed value.
    expect(typeof total).toBe("string");
  });
});

describe("(c) hybrid AcroForm + XFA: samples for the Acrobat check", () => {
  it("fills the 1040 AcroForm layer and writes keep/strip variants", async () => {
    const original = new Uint8Array(readFileSync(join(OUT_DIR, "..", "irs", "f1040.pdf")));
    const doc = await open(original);
    const page = doc.pages[0]!;
    const ws = await widgets(doc);
    const texts = ws.filter((w) => w.field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD).slice(0, 4);
    const filled: string[] = [];
    for (const [i, w] of texts.entries()) {
      await engine
        .setFormFieldValue(doc, page, w, { kind: "text", text: `SPIKE ${i + 1}` })
        .toPromise();
      filled.push(w.field.name);
    }
    const check = ws.find((w) => w.field.type === PDF_FORM_FIELD_TYPE.CHECKBOX);
    if (check) {
      await engine
        .setFormFieldValue(doc, page, check, { kind: "checked", checked: true })
        .toPromise();
      filled.push(check.field.name);
    }
    const keep = new Uint8Array(await engine.saveAsCopy(doc).toPromise());
    await engine.closeDocument(doc).toPromise();
    const incremental =
      keep.length > original.length &&
      Buffer.from(keep.subarray(0, original.length)).equals(Buffer.from(original));
    console.log("1040 filled", filled, "| PDFium save is incremental:", incremental);
    writeFileSync(join(OUT, "f1040-keep-xfa.pdf"), keep);

    for (const [name, keys] of [
      ["f1040-strip-xfa.pdf", ["XFA"]],
      ["f1040-strip-xfa-perms.pdf", ["XFA", "Perms"]],
    ] as const) {
      const pdf = await PDFDocument.load(keep, { updateMetadata: false });
      pdf.getForm().acroForm.dict.delete(PDFName.of("XFA"));
      if (keys.includes("Perms" as never)) pdf.catalog.delete(PDFName.of("Perms"));
      writeFileSync(join(OUT, name), await pdf.save({ updateFieldAppearances: false }));
    }
    expect(filled.length).toBeGreaterThan(0);
  });
});
