// Phase 10a: crash reports never contain document text or file names.
import { describe, expect, it } from "vitest";
import {
  buildReport,
  formatReport,
  installCrashHandlers,
  scrubMessage,
  scrubStack,
} from "../../src/app/crash";

// Synthetic "client data" that must never reach a report.
const SECRET = "Jane Q Taxpayer 123-45-6789";
const PATH = "C:\\Users\\jsmith\\Clients\\Taxpayer Jane\\2025 Return.pdf";
const UNC = "\\\\fileserver\\clients\\Taxpayer\\return.pdf";

describe("crash reports", () => {
  it("withholds the message of ordinary errors (they may quote the document)", () => {
    const r = buildReport("error", new Error(`Could not read ${SECRET} from ${PATH}`), "1.0.0");
    const text = formatReport(r);
    expect(text).not.toContain("Jane");
    expect(text).not.toContain("6789");
    expect(text).not.toContain("jsmith");
    expect(r.message).toMatch(/^\(message withheld: \d+ characters, hash [0-9a-f]{8}\)$/);
  });

  it("keeps code errors but cuts quotes, paths and numbers", () => {
    const r = buildReport(
      "error",
      new TypeError(
        `Cannot read properties of undefined (reading '${SECRET}') at ${PATH} ${UNC} 4455667`,
      ),
      "1.0.0",
    );
    expect(r.message).toContain("Cannot read properties of undefined");
    for (const bad of ["Jane", "jsmith", "fileserver", "4455667", "6789"])
      expect(r.message).not.toContain(bad);
    expect(scrubMessage("x is not a function")).toBe("x is not a function");
  });

  it("keeps stack function names and our file name, never folders", () => {
    const stack = [
      "TypeError: boom",
      "    at renderPage (http://tauri.localhost/assets/index-AbC123.js:10:20)",
      "    at file:///C:/Users/jsmith/AppData/Local/PDF%20Workbench/x.js:1:2",
      "    at Object.<anonymous> (C:\\Users\\jsmith\\Clients\\Taxpayer\\evil.js:3:4)",
      "doThing@http://tauri.localhost/assets/worker-1.js:5:6",
    ].join("\n");
    const frames = scrubStack(stack);
    expect(frames[0]).toBe("renderPage (index-AbC123.js:10:20)");
    expect(frames.join("\n")).not.toMatch(/jsmith|Clients|Taxpayer|Users/);
    expect(frames).toHaveLength(4);
  });

  it("handles thrown non-errors", () => {
    const r = buildReport("unhandledrejection", SECRET, "1.0.0");
    expect(r.name).toBe("string");
    expect(formatReport(r)).not.toContain("Jane");
  });

  it("writes at most five reports per session", async () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const target = {
      addEventListener: (t: string, h: (e: unknown) => void) => void handlers.set(t, h),
    };
    const written: string[] = [];
    installCrashHandlers(target, "1.0.0", async (t) => {
      written.push(t);
    });
    for (let i = 0; i < 8; i++) handlers.get("unhandledrejection")?.({ reason: new Error(SECRET) });
    handlers.get("error")?.({ error: undefined, message: "" }); // resource error
    expect(written).toHaveLength(5);
    expect(written.join("")).not.toContain("Jane");
  });
});
