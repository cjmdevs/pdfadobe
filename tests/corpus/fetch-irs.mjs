#!/usr/bin/env node
// Downloads blank IRS forms (U.S. government works, public domain) into tests/corpus/irs/.
// These are committed so tests never need the network. Rerun only to refresh them,
// then update the table in tests/corpus/README.md (date + SHA-256).

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FORMS = ["f1040", "fw9", "f8879"];
const dir = join(dirname(fileURLToPath(import.meta.url)), "irs");
mkdirSync(dir, { recursive: true });

for (const f of FORMS) {
  const url = `https://www.irs.gov/pub/irs-pdf/${f}.pdf`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 5).toString() !== "%PDF-") throw new Error(`${url}: not a PDF`);
  writeFileSync(join(dir, `${f}.pdf`), buf);
  const sha = createHash("sha256").update(buf).digest("hex");
  console.log(`${f}.pdf  ${buf.length} bytes  sha256 ${sha}  ${url}`);
}
