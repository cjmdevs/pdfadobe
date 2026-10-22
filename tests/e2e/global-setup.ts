// Playwright global setup: make sure the synthetic corpus exists (Vitest does the same),
// so `npm run test:e2e` works on a fresh clone without running `npm test` first.
import { generateCorpus } from "../corpus/generate.mjs";

export default async function setup(): Promise<void> {
  await generateCorpus();
}
