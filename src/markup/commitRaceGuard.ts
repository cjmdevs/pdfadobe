// Workaround for a race in @embedpdf/plugin-annotation 2.15.1 (owner report, Phase 3
// check): when a commit to PDFium finishes, the plugin marks every annotation of that
// batch as saved ("synced"), even one changed again while the commit ran (a quick
// Ctrl+Z, Ctrl+Y, or two colour clicks). That later change then never reached PDFium,
// so the screen and the saved file disagreed.
//
// Fix: a batch's list of committed annotations is read when the commit finishes; we make
// it contain only annotations still exactly as they were sent. The others stay "dirty"
// and the plugin commits them right after (it re-commits while changes are pending).
// The plugin internals used here are checked; if they change, nothing is patched and
// `installCommitRaceGuard` returns false (tests/unit/markup-commit-race.test.ts).

interface Batch {
  committedUids: string[];
}

interface PluginInternals {
  executeCommitBatch?: (docId: string, doc: unknown, batch: Batch) => unknown;
  getDocumentState?: (docId: string) => { byUid: Record<string, { object: unknown }> } | undefined;
  __pdfwbCommitGuard?: boolean;
}

export function installCommitRaceGuard(plugin: unknown): boolean {
  const p = plugin as PluginInternals | null;
  if (!p || typeof p.executeCommitBatch !== "function" || typeof p.getDocumentState !== "function")
    return false;
  if (p.__pdfwbCommitGuard) return true;
  const original = p.executeCommitBatch.bind(p);
  const stateOf = p.getDocumentState.bind(p);
  p.executeCommitBatch = (docId, doc, batch) => {
    const uids = batch.committedUids;
    const sent = new Map(uids.map((uid) => [uid, stateOf(docId)?.byUid[uid]?.object]));
    Object.defineProperty(batch, "committedUids", {
      configurable: true,
      get: () => uids.filter((uid) => stateOf(docId)?.byUid[uid]?.object === sent.get(uid)),
    });
    return original(docId, doc, batch);
  };
  p.__pdfwbCommitGuard = true;
  return true;
}
