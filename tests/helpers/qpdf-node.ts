// Node runner for the engine's qpdf jobs in tests: the MCP server's runner, with job
// folders in <temp>/pdfwb-test-jobs (never named like the server's own job folders).
import { testJobs } from "./job-dir";
import { qpdfBin } from "../corpus/generate.mjs";
import { nodeQpdf as runner } from "../../mcp-server/src/runtime/qpdf";
import type { Qpdf } from "../../src/engine/pages/qpdf";

export function nodeQpdf(bin = qpdfBin()): Qpdf {
  return runner(bin, testJobs);
}
