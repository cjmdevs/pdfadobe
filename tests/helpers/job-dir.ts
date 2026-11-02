// Job-folder base for the qpdf and OCR runners in tests: <temp>/pdfwb-test-jobs.
// Keeps test job folders out of the temp root, where mcp-safety checks that the MCP
// server itself never creates any.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function testJobs(): string {
  const dir = join(tmpdir(), "pdfwb-test-jobs");
  mkdirSync(dir, { recursive: true });
  return dir;
}
