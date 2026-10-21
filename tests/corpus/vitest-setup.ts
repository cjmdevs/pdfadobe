// Vitest global setup: make sure the synthetic corpus exists before any test runs.
import { generateCorpus } from "./generate.mjs";

export default async function setup(): Promise<void> {
  await generateCorpus();
}
