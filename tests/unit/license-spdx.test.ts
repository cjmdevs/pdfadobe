import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { parse, satisfy } from "../../scripts/license-spdx.mjs";

const allowed = new Set(["MIT", "Apache-2.0", "BSD-3-Clause", "MPL-2.0", "ISC"]);
const extras = new Set(["Unicode-3.0", "GPL-3.0-only"]); // GPL here must still be refused
const check = (e: string): string[] | null => satisfy(parse(e), allowed, extras);

describe("license SPDX policy", () => {
  it.each(["MIT", "Apache-2.0 OR MIT", "MIT/Apache-2.0", "(MIT OR Apache-2.0)", "MIT OR GPL-3.0"])(
    "allows %s",
    (e) => expect(check(e)).toEqual([]),
  );

  it.each([
    "GPL-3.0-only",
    "GPL-2.0+",
    "LGPL-2.1-or-later",
    "AGPL-3.0",
    "MIT AND GPL-2.0-only",
    "SSPL-1.0",
    "CC-BY-SA-4.0",
    "WTFPL",
  ])("rejects %s", (e) => expect(check(e)).toBeNull());

  it("reports approved extras that were needed", () => {
    expect(check("(MIT OR Apache-2.0) AND Unicode-3.0")).toEqual(["Unicode-3.0"]);
    expect(check("Unicode-3.0 OR MIT")).toEqual([]);
  });

  it("throws on malformed expressions", () => {
    expect(() => parse("(MIT OR")).toThrow();
    expect(() => parse("MIT Apache-2.0")).toThrow();
  });
});
