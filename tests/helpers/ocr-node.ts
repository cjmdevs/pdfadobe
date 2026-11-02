// Node runner for the engine's OCR jobs in tests: the MCP server's runner, with the
// bundled sidecar and job folders in the system temp folder. Missing sidecar is a test
// failure.
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeOcr as runner } from "../../mcp-server/src/runtime/ocr";
import type { Ocr } from "../../src/engine/ocr/tesseract";

export const TESSERACT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src-tauri/vendor/tesseract",
);

export function nodeOcr(dir = TESSERACT_DIR): Ocr {
  return runner(dir, tmpdir);
}
