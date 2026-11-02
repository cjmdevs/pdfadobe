// Node runner for the engine's qpdf jobs in tests: the MCP server's runner, with job
// folders in the system temp folder.
import { tmpdir } from "node:os";
import { qpdfBin } from "../corpus/generate.mjs";
import { nodeQpdf as runner } from "../../mcp-server/src/runtime/qpdf";
import type { Qpdf } from "../../src/engine/pages/qpdf";

export function nodeQpdf(bin = qpdfBin()): Qpdf {
  return runner(bin, tmpdir);
}
