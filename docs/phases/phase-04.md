# Phase 4: workpaper layer (PDFlyer-style)

Read CLAUDE.md and everything in docs/reference/. This is Phase 4: the workpaper
layer, modeled on CCH PDFlyer. Where the reference docs and this prompt disagree,
list the differences and ask before building.

UI: opens from the Tools pane (backlog B4) with its own toolbar holding every item
below; any of them can also be pinned to the quick toolbar.

Storage rule: every item is a standard PDF annotation (stamp, line, free text) so it
displays in Acrobat. Each is tagged with a custom key (e.g. /PWType /Tickmark) plus a
readable Subject so our app can find and edit them later.

1. Tickmark library: built-in firm set (red symbols, drawn by us; never copy CCH's
   stamp files): Agrees to (check), Agrees to General Ledger (GL), Agrees to Prior
   Year (PY), Calculated, Confirmed (C), Confirmed with exception, Confirmed with
   exception cleared, Consistent & Comparable with Prior Year, Cross-footed, Footed,
   Immaterial (i), No Reply (NR), Recalculated, Unreconciled Difference (UD).
   User-created tickmarks from a symbol, letter, or image; per tickmark symbol, color,
   size, meaning. Letter/number tickmarks (A, B, C / 1, 2, 3) circled or plain, with
   optional auto-increment. Toolbar: active-tickmark button, library dropdown, Recent
   dropdown with "Clear Recent Stamps". Floating palette; number keys / hotkey switch
   the active tickmark; click to place repeatedly until Esc. Firm library (read-only)
   on a network share + personal library. Tickmark legend page or box.
2. Connectors: line/arrow between two points or two annotations; styles, colors,
   arrowheads; stays attached when either end moves; optional link to jump between ends.
3. User and status stamps: initials, name, date/time, role (Prepared by / Reviewed by /
   Final), workpaper reference, custom fields.
4. Calculator tape: 10-key and standard calculator, tape color; click a number on the
   PDF to send it; tape placed as an annotation; foot/cross-foot with variance.
5. Notes: workpaper notes with author and date, listed in a panel.
6. Stamp Summary panel: every item with page and position; filter by type and author;
   click to jump; export to CSV.
7. Settings: export/import tickmarks, stamps, calculator settings as one JSON file.
8. Existing files: PDFlyer tickmarks/stamps in old workpapers render and are listed.
   Inspect a synthetic PDFlyer-marked sample first.

Tests: place one of each item, save, reopen in our app (fully editable) and verify
they render in Acrobat. Stamp Summary must find items placed in a previous session.
Keep tests simple and only what is necessary (owner, 2026-10-27).

Owner decisions during planning (2026-10-27):

- No PDFlyer screenshots or sample file yet. We draw the 14 firm tickmarks ourselves
  from their names (red); the owner reviews them at the stage 1 check.
- Item 8 is stage 4 and waits for a synthetic PDFlyer sample in `tests/corpus/pdflyer/`.
- Firm library is a JSON file on a share, mirrored locally, read-only in the app for
  everyone; maintained through Settings import/export.
- Connectors re-attach in our app only; jump links are /Link annotations at each end
  so they work in Acrobat too.
- The tool keeps the label "Workpaper Tools" (not "PDFlyer").
- Click-a-number needs a text layer (scans wait for OCR).
- Stages: 1 tickmarks + legend + Stamp Summary + settings JSON; 2 connectors, user/
  status stamps, notes; 3 calculator tape and foot/cross-foot; 4 PDFlyer marks.

## Gate

- `npm run check` passes and `npm run test:e2e` passes.
- Round-trip test: one of each item saved, reopened, read by an independent parser.
- Manual Windows check by the owner, including Acrobat.
