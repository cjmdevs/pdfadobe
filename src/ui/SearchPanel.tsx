// Find: query box, match options, and a result list with surrounding text.
// Queries and results never leave this component (no logging: CLAUDE.md).
import { useEffect, useRef, useState } from "react";
import { MatchFlag } from "@embedpdf/models";
import { useSearch } from "@embedpdf/plugin-search/react";
import { useWorkbench } from "../app/workbench";
import { Icon } from "./Icon";

export function SearchPanel({ documentId }: { documentId: string }) {
  const { setSearchOpen } = useWorkbench();
  const { state, provides: search } = useSearch(documentId);
  const [query, setQuery] = useState(state.query);
  const [matchCase, setMatchCase] = useState(state.flags.includes(MatchFlag.MatchCase));
  const [wholeWord, setWholeWord] = useState(state.flags.includes(MatchFlag.MatchWholeWord));
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const refocus = () => {
      input.current?.focus();
      input.current?.select();
    };
    document.addEventListener("pdfwb:focus-search", refocus);
    return () => document.removeEventListener("pdfwb:focus-search", refocus);
  }, []);

  useEffect(() => {
    const flags = [matchCase && MatchFlag.MatchCase, wholeWord && MatchFlag.MatchWholeWord].filter(
      (f): f is MatchFlag => f !== false,
    );
    search?.setFlags(flags);
  }, [search, matchCase, wholeWord]);

  // Keep the active result visible in the list.
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [state.activeResultIndex]);

  const run = () => {
    if (!search) return;
    if (!query.trim()) {
      search.stopSearch();
      return;
    }
    search.startSearch();
    search.searchAllPages(query);
  };

  return (
    <aside className="search-panel" aria-label="Find">
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (query === state.query && state.total > 0) search?.nextResult();
          else run();
        }}
      >
        <input
          ref={input}
          type="search"
          aria-label="Find text"
          placeholder="Find in document"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="primary">
          Find
        </button>
        <button
          type="button"
          className="tool"
          aria-label="Close find"
          onClick={() => setSearchOpen(false)}
        >
          <Icon name="close" size={14} />
        </button>
      </form>
      <div className="search-options">
        <label className="check">
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(e) => setMatchCase(e.target.checked)}
          />
          Match case
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => setWholeWord(e.target.checked)}
          />
          Whole words
        </label>
      </div>
      <div className="search-summary" role="status" data-testid="search-summary">
        {state.loading
          ? "Searching…"
          : state.query
            ? state.total === 0
              ? "No matches"
              : `${state.activeResultIndex + 1} of ${state.total} matches`
            : ""}
        {state.total > 0 && (
          <span className="button-row inline">
            <button
              type="button"
              onClick={() => search?.previousResult()}
              aria-label="Previous result (Shift+F3)"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => search?.nextResult()}
              aria-label="Next result (F3)"
            >
              ›
            </button>
          </span>
        )}
      </div>
      <ol className="search-results" ref={list} aria-label="Search results">
        {state.results.map((r, i) => (
          <li key={`${r.pageIndex}-${r.charIndex}`}>
            <button
              type="button"
              data-testid="search-result"
              aria-current={i === state.activeResultIndex}
              className={i === state.activeResultIndex ? "active" : ""}
              onClick={() => search?.goToResult(i)}
            >
              <span className="result-page">Page {r.pageIndex + 1}</span>
              <span className="result-context">
                {r.context.truncatedLeft && "…"}
                {r.context.before}
                <mark>{r.context.match}</mark>
                {r.context.after}
                {r.context.truncatedRight && "…"}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
