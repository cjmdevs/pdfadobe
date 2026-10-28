// Redact panel (Phase 5), shown in the Tools pane while Redact is open:
// Search & Redact (text, built-in patterns, own pattern), the review list of every mark
// (accept or reject each), overlay options, Apply and Sanitize Document.
// Found text is shown here only; it is never logged or saved.
import { useMemo, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useWorkbench } from "../../app/workbench";
import { pageOp } from "../../app/pages";
import {
  ALL_SANITIZE,
  PATTERNS,
  regexError,
  type MarkCandidate,
  type PatternId,
  type SanitizeOptions,
} from "../../engine/redact";
import { SOURCE_LABELS, addCandidates, marksOf, type Mark } from "./marks";
import { redactMarks, useRedactVersion } from "./redactStore";
import { useRedactCommands } from "./useRedact";

const SANITIZE_LABELS: Record<keyof SanitizeOptions, string> = {
  metadata: "Document properties and XMP metadata",
  attachments: "Attachments",
  javascript: "JavaScript and actions that run by themselves",
  privateData: "Private application data (includes Acrobat's embedded search index)",
  hiddenText: "Hidden text (invisible text, including OCR layers, and text off the page)",
};

export default function RedactPanel({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const { provides: scope, state } = useAnnotation(documentId);
  const { provides: scroll } = useScroll(documentId);
  const doc = useDocumentState(documentId)?.document ?? null;
  const cmds = useRedactCommands(documentId, true);
  useRedactVersion();
  const overlay = redactMarks.overlay();

  const [literal, setLiteral] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [patterns, setPatterns] = useState<PatternId[]>(
    PATTERNS.filter((p) => p.defaultOn).map((p) => p.id),
  );
  const [regex, setRegex] = useState("");
  const [found, setFound] = useState<MarkCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [alsoSanitize, setAlsoSanitize] = useState(false);
  const [sanitizeOpt, setSanitizeOpt] = useState<SanitizeOptions>(ALL_SANITIZE);
  const regexProblem = regex ? regexError(regex) : null;

  const marks = useMemo(
    () => marksOf(Object.values(state.byUid).map((t) => t.object)),
    [state.byUid],
  );
  const heights = doc?.pages.map((p) => p.size.height) ?? [];

  const search = async () => {
    setSearching(true);
    try {
      const bytes = await wb.contentBytes(documentId);
      if (!bytes) return;
      setFound(
        await pageOp("redactSearch", bytes, {
          patterns,
          literals: literal.trim() ? [literal] : [],
          matchCase,
          wholeWord,
          regexes: regex && !regexProblem ? [{ source: regex }] : [],
        }),
      );
    } catch (e) {
      wb.toast(`Search failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setSearching(false);
    }
  };

  const markFound = () => {
    if (!scope || !found?.length) return;
    addCandidates(scope, documentId, heights, found, wb.author);
    wb.toast(`Marked ${found.length} item(s). Review them below, then Apply.`);
    setFound(null);
  };

  const jump = (m: Mark) => {
    scroll?.scrollToPage({
      pageNumber: m.pageIndex + 1,
      pageCoordinates: { x: 0, y: m.rects[0]?.origin.y ?? 0 },
      behavior: "instant",
      alignY: 30,
    });
  };

  const reject = (list: Mark[]) => {
    if (!scope || !list.length) return;
    scope.deleteAnnotations(list.map((m) => ({ pageIndex: m.pageIndex, id: m.id })));
    redactMarks.forget(
      documentId,
      list.map((m) => m.id),
    );
  };

  const accepted = marks.filter((m) => redactMarks.accepted(documentId, m.id));

  return (
    <section className="redact-panel" aria-label="Redact" data-testid="redact-panel">
      <details open>
        <summary>Search &amp; Redact</summary>
        <label>
          Find text
          <input
            type="text"
            value={literal}
            onChange={(e) => setLiteral(e.target.value)}
            placeholder="A name, number or phrase"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(e) => setMatchCase(e.target.checked)}
          />
          Match case
        </label>
        <label>
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => setWholeWord(e.target.checked)}
          />
          Whole words only
        </label>
        <fieldset>
          <legend>Patterns</legend>
          {PATTERNS.map((p) => (
            <label key={p.id} title={p.help}>
              <input
                type="checkbox"
                checked={patterns.includes(p.id)}
                onChange={(e) =>
                  setPatterns((cur) =>
                    e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id),
                  )
                }
              />
              {p.label}
            </label>
          ))}
        </fieldset>
        <label>
          Your own pattern (regular expression)
          <input
            type="text"
            value={regex}
            onChange={(e) => setRegex(e.target.value)}
            placeholder="e.g. CL-\d{5}"
            aria-invalid={regexProblem !== null}
          />
        </label>
        {regexProblem && <p className="hint error">{regexProblem}</p>}
        <button type="button" onClick={() => void search()} disabled={searching}>
          {searching ? "Searching…" : "Find"}
        </button>
        <p className="hint">Scanned pages need OCR first; mark them with Draw Box.</p>
        {found && (
          <div data-testid="redact-found">
            <p>{found.length === 0 ? "Nothing found." : `${found.length} found:`}</p>
            <ul>
              {found.map((f, i) => (
                <li key={i}>
                  Page {f.pageIndex + 1} · {SOURCE_LABELS[f.source]}: <code>{f.text}</code>
                </li>
              ))}
            </ul>
            {found.length > 0 && (
              <button type="button" onClick={markFound}>
                Mark all {found.length}
              </button>
            )}
          </div>
        )}
      </details>

      <details open>
        <summary>
          Review ({accepted.length} of {marks.length} accepted)
        </summary>
        {marks.length === 0 && (
          <p className="hint">No marks yet: use Find, Draw Box, Mark Text or Mark Page.</p>
        )}
        {marks.length > 0 && (
          <div className="row">
            <button
              type="button"
              onClick={() =>
                redactMarks.setAccepted(
                  documentId,
                  marks.map((m) => m.id),
                  true,
                )
              }
            >
              Accept all
            </button>
            <button type="button" onClick={() => reject(marks)}>
              Reject all
            </button>
          </div>
        )}
        <ul data-testid="redact-review">
          {marks.map((m) => {
            const info = redactMarks.info(documentId, m.id);
            const ok = redactMarks.accepted(documentId, m.id);
            return (
              <li key={m.id} data-accepted={ok}>
                <button type="button" className="link" onClick={() => jump(m)}>
                  Page {m.pageIndex + 1} · {SOURCE_LABELS[info?.source ?? "manual"]}
                  {info?.text ? (
                    <>
                      : <code>{info.text}</code>
                    </>
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-pressed={ok}
                  onClick={() => redactMarks.setAccepted(documentId, [m.id], !ok)}
                >
                  {ok ? "Accepted" : "Accept"}
                </button>
                <button type="button" onClick={() => reject([m])}>
                  Reject
                </button>
              </li>
            );
          })}
        </ul>
      </details>

      <details open>
        <summary>Overlay</summary>
        <label>
          <input
            type="checkbox"
            checked={overlay.fill !== null}
            onChange={(e) => redactMarks.setOverlay({ fill: e.target.checked ? "#000000" : null })}
          />
          Fill the box
        </label>
        {overlay.fill !== null && (
          <label>
            Fill colour
            <input
              type="color"
              value={overlay.fill}
              onChange={(e) => redactMarks.setOverlay({ fill: e.target.value })}
            />
          </label>
        )}
        <label>
          Overlay text
          <input
            type="text"
            value={overlay.text}
            placeholder='e.g. "Redacted"'
            onChange={(e) => redactMarks.setOverlay({ text: e.target.value })}
          />
        </label>
        <label>
          Text colour
          <input
            type="color"
            value={overlay.textColor}
            onChange={(e) => redactMarks.setOverlay({ textColor: e.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={overlay.repeat}
            onChange={(e) => redactMarks.setOverlay({ repeat: e.target.checked })}
          />
          Repeat the text to fill the box
        </label>
      </details>

      <details open>
        <summary>Apply</summary>
        <label>
          <input
            type="checkbox"
            checked={alsoSanitize}
            onChange={(e) => setAlsoSanitize(e.target.checked)}
          />
          Also run Sanitize Document (options below)
        </label>
        <button
          type="button"
          className="primary"
          data-testid="redact-apply"
          disabled={!cmds || accepted.length === 0 || cmds.working}
          onClick={() => void cmds?.apply(alsoSanitize ? sanitizeOpt : null)}
        >
          {cmds?.working ? "Working…" : `Apply ${accepted.length} accepted mark(s)`}
        </button>
        <p className="hint">
          Writes a new file, &quot;{wb.meta[documentId]?.name.replace(/\.pdf$/i, "")}
          _Redacted.pdf&quot;. The content under each box is removed for good; the original is not
          changed. Marks not accepted are left out.
        </p>
      </details>

      <details>
        <summary>Sanitize Document</summary>
        {(Object.keys(SANITIZE_LABELS) as (keyof SanitizeOptions)[]).map((k) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={sanitizeOpt[k]}
              onChange={(e) => setSanitizeOpt((o) => ({ ...o, [k]: e.target.checked }))}
            />
            {SANITIZE_LABELS[k]}
          </label>
        ))}
        <button
          type="button"
          data-testid="sanitize-run"
          disabled={!cmds || cmds.working}
          onClick={() => void cmds?.sanitize(sanitizeOpt)}
        >
          Sanitize into a new file
        </button>
        <p className="hint">
          Writes &quot;{wb.meta[documentId]?.name.replace(/\.pdf$/i, "")}_Sanitized.pdf&quot;, fully
          rewritten: earlier versions and unused objects are dropped.
        </p>
      </details>
    </section>
  );
}
