// Phase 8: saved signature images (and passwords) never reach a log. The signing code
// has no logging at all, and the Rust side only prints in its own tests.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const files = (dir: string) => readdirSync(join(ROOT, dir)).map((f) => join(ROOT, dir, f));

describe("no logging in signature code", () => {
  it("TypeScript: no console calls", () => {
    for (const f of [
      ...files("src/ui/sign"),
      ...files("src/engine/sign"),
      join(ROOT, "src/engine/security.ts"),
      join(ROOT, "src/platform/browserCert.ts"),
    ]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\bconsole\./);
    }
  });

  it("Rust: no printing outside tests", () => {
    for (const f of ["src-tauri/src/signatures.rs", "src-tauri/src/certsign.rs"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      const body = src.split(/#\[cfg\(all\(test, windows\)\)\]/)[0] ?? src;
      expect(body, f).not.toMatch(/\b(e?println|e?print|dbg|log::\w+)!/);
    }
  });
});
