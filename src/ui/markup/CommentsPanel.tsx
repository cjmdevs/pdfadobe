// Comments panel (Phase 3; header like Acrobat's since B6): "N comments" with search,
// sort, filter and an options menu; every comment with author, date and page; reply
// threads; review status; click to jump. Comment text never reaches a log (CLAUDE.md).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { PdfAnnotationSubtype, type PdfAnnotationObject } from "@embedpdf/models";
import { useWorkbench } from "../../app/workbench";
import {
  COMMENT_SORTS,
  NO_FILTER,
  REVIEW_STATUSES,
  buildThreads,
  colorOf,
  filterChoices,
  filterThreads,
  newReply,
  newState,
  searchThreads,
  sortThreads,
  typeLabel,
  type CommentFilter,
  type CommentSort,
  type CommentThread,
  type ReviewStatus,
} from "../../markup/comments";
import { useDocToolContext } from "../../tools/useToolContext";
import { Icon } from "../Icon";
import { exportXfdfFile, summaryToNewFile } from "./markupFiles";

const when = (a: PdfAnnotationObject) => {
  const d = a.modified ?? a.created;
  return d ? d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "";
};

export function CommentsPanel({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const ctx = useDocToolContext(documentId);
  const { provides: scope, state } = useAnnotation(documentId);
  const { provides: scroll } = useScroll(documentId);
  const [filter, setFilter] = useState<CommentFilter>(NO_FILTER);
  /** Search text; null while the search box is closed. */
  const [query, setQuery] = useState<string | null>(null);
  const [sort, setSort] = useState<CommentSort>("page");
  const [pop, setPop] = useState<"sort" | "filter" | "more" | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const all = useMemo(() => Object.values(state.byUid).map((t) => t.object), [state.byUid]);
  const threads = useMemo(() => buildThreads(all), [all]);
  const choices = useMemo(() => filterChoices(threads), [threads]);
  const shown = sortThreads(searchThreads(filterThreads(threads, filter), query ?? ""), sort);
  const filtering = Object.values(filter).some((v) => v !== null);
  const selected = new Set(state.selectedUids.map((u) => state.byUid[u]?.object.id));

  const jump = (a: PdfAnnotationObject) => {
    scroll?.scrollToPage({
      pageNumber: a.pageIndex + 1,
      pageCoordinates: { x: a.rect.origin.x, y: a.rect.origin.y },
      behavior: "instant",
      alignY: 30,
    });
    scope?.selectAnnotation(a.pageIndex, a.id);
  };

  const pick = <K extends keyof CommentFilter>(k: K, v: string) =>
    setFilter((f) => ({ ...f, [k]: v === "" ? null : v }));

  const item = (label: string, run: () => void, checked?: boolean) => (
    <li role="none" key={label}>
      <button
        type="button"
        role={checked === undefined ? "menuitem" : "menuitemradio"}
        aria-checked={checked}
        onClick={() => {
          setPop(null);
          run();
        }}
      >
        <span className="tick" aria-hidden="true">
          {checked ? "✓" : ""}
        </span>
        {label}
      </button>
    </li>
  );
  const count =
    shown.length === threads.length
      ? `${threads.length} comment${threads.length === 1 ? "" : "s"}`
      : `${shown.length} of ${threads.length} comments`;

  return (
    <aside className="comments-panel" aria-label="Comments" data-testid="comments-panel">
      <header className="panel-header">
        <h2>{count}</h2>
        <span className="comment-tools">
          <button
            type="button"
            className="tool"
            aria-label="Search comments"
            title="Search comments"
            aria-pressed={query !== null}
            onClick={() => setQuery(query === null ? "" : null)}
          >
            <Icon name="search" />
          </button>
          <PopButton
            label="Sort comments"
            icon="sort"
            open={pop === "sort"}
            onOpen={(on) => setPop(on ? "sort" : null)}
          >
            <ul className="action-menu" role="menu" aria-label="Sort by">
              {COMMENT_SORTS.map((o) => item(o.label, () => setSort(o.id), sort === o.id))}
            </ul>
          </PopButton>
          <PopButton
            label="Filter comments"
            icon="filter"
            open={pop === "filter"}
            pressed={filtering}
            onOpen={(on) => setPop(on ? "filter" : null)}
          >
            <div className="comment-filters" role="group" aria-label="Filter comments">
              <FilterSelect
                label="Type"
                value={filter.type}
                options={choices.types}
                onPick={(v) => pick("type", v)}
              />
              <FilterSelect
                label="Author"
                value={filter.author}
                options={choices.authors}
                onPick={(v) => pick("author", v)}
              />
              <FilterSelect
                label="Color"
                value={filter.color}
                options={choices.colors}
                onPick={(v) => pick("color", v)}
              />
              <FilterSelect
                label="Status"
                value={filter.status}
                options={REVIEW_STATUSES}
                onPick={(v) => pick("status", v)}
              />
              <button type="button" disabled={!filtering} onClick={() => setFilter(NO_FILTER)}>
                Clear filters
              </button>
            </div>
          </PopButton>
          <PopButton
            label="Options"
            icon="more"
            open={pop === "more"}
            onOpen={(on) => setPop(on ? "more" : null)}
          >
            <ul className="action-menu" role="menu" aria-label="Comment options">
              {item("Expand All", () => setCollapsed(false))}
              {item("Collapse All", () => setCollapsed(true))}
              {item("Export All to Data File (XFDF)…", () => void exportXfdfFile(wb, documentId))}
              {item("Import Data File (XFDF)…", () => void ctx.markup?.importXfdf())}
              {item("Create Comment Summary", () => void summaryToNewFile(wb, documentId))}
              {item("Flatten Comments…", () =>
                wb.setDialog({
                  kind: "flatten",
                  documentId,
                  page: ctx.pages[0] ?? 0,
                  selectedIds: ctx.markup?.selectedIds ?? [],
                }),
              )}
            </ul>
          </PopButton>
          <button
            type="button"
            className="tool"
            aria-label="Close comments"
            onClick={() => wb.updateSettings({ commentsOpen: false })}
          >
            <Icon name="close" />
          </button>
        </span>
      </header>
      {query !== null && (
        <input
          className="comment-search"
          type="search"
          aria-label="Search text"
          placeholder="Search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery(null)}
        />
      )}
      {shown.length === 0 ? (
        <p className="hint">{threads.length ? "No comments match." : "No comments yet."}</p>
      ) : (
        <ol className="comment-list">
          {shown.map((t) => (
            <CommentItem
              key={t.annotation.id}
              thread={t}
              selected={selected.has(t.annotation.id)}
              onJump={() => jump(t.annotation)}
              author={wb.author}
              scope={scope}
              collapsed={collapsed && !selected.has(t.annotation.id)}
            />
          ))}
        </ol>
      )}
    </aside>
  );
}

/** A header icon that opens a small popover below it; a click elsewhere or Esc closes it. */
function PopButton({
  label,
  icon,
  open,
  pressed,
  onOpen,
  children,
}: {
  label: string;
  icon: "sort" | "filter" | "more";
  open: boolean;
  pressed?: boolean;
  onOpen: (on: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const latest = useRef(onOpen);
  useEffect(() => {
    latest.current = onOpen;
  });
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) latest.current(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") latest.current(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span className="pop" ref={ref}>
      <button
        type="button"
        className="tool"
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
        onClick={() => onOpen(!open)}
      >
        <Icon name={icon} />
      </button>
      {open && <div className="pop-body">{children}</div>}
    </span>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string | null;
  options: string[];
  onPick: (v: string) => void;
}) {
  return (
    <label className="props-field">
      <span>{label}</span>
      <select
        aria-label={`Filter by ${label.toLowerCase()}`}
        value={value ?? ""}
        onChange={(e) => onPick(e.target.value)}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

type Scope = ReturnType<typeof useAnnotation>["provides"];

function CommentItem({
  thread,
  selected,
  onJump,
  author,
  scope,
  collapsed,
}: {
  thread: CommentThread;
  selected: boolean;
  onJump: () => void;
  author: string;
  scope: Scope;
  /** Only the head and text (Collapse All). */
  collapsed: boolean;
}) {
  const a = thread.annotation;
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const locked = a.flags?.includes("locked") || a.flags?.includes("lockedContents");
  const color = colorOf(a);
  const hasText = a.type !== PdfAnnotationSubtype.STAMP;

  const setContents = (contents: string) => {
    if (contents !== (a.contents ?? "")) scope?.updateAnnotation(a.pageIndex, a.id, { contents });
  };
  const sendReply = () => {
    const text = reply.trim();
    if (!text) return;
    scope?.createAnnotation(a.pageIndex, newReply(a, text, author));
    setReply("");
    setReplying(false);
  };
  const setStatus = (s: ReviewStatus) =>
    scope?.createAnnotation(a.pageIndex, newState(a, "Review", s, author));
  const toggleMark = () =>
    scope?.createAnnotation(
      a.pageIndex,
      newState(a, "Marked", thread.marked ? "Unmarked" : "Marked", author),
    );

  return (
    <li
      className={`comment${selected ? " selected" : ""}`}
      aria-current={selected ? "true" : undefined}
      data-testid="comment"
    >
      <button type="button" className="comment-head" onClick={onJump} title="Show on the page">
        <span className="avatar" aria-hidden="true">
          {(a.author || "?").trim().charAt(0).toUpperCase()}
        </span>
        <span className="comment-author">{a.author || "Unknown"}</span>
        <span className="comment-meta">{when(a)}</span>
        <span className="comment-line">
          {color && <span className="swatch" style={{ background: color }} aria-hidden="true" />}
          <span className="comment-type">{typeLabel(a)}</span>
          <span className="comment-meta">p. {a.pageIndex + 1}</span>
        </span>
      </button>
      {!hasText &&
        (a.contents ? (
          <p className="comment-text">{a.contents}</p>
        ) : (
          <p className="comment-text placeholder">Applied Stamp</p>
        ))}
      {hasText &&
        (selected && !locked ? (
          <textarea
            className="comment-text"
            aria-label="Comment text"
            defaultValue={a.contents ?? ""}
            key={a.contents ?? ""}
            rows={3}
            onBlur={(e) => setContents(e.target.value)}
          />
        ) : (
          a.contents && <p className="comment-text">{a.contents}</p>
        ))}
      {!collapsed && thread.replies.length > 0 && (
        <ol className="replies" aria-label="Replies">
          {thread.replies.map((r) => (
            <li key={r.id}>
              <span className="comment-author">{r.author || "Unknown"}</span>{" "}
              <span className="comment-meta">{when(r)}</span>
              <p className="comment-text">{r.contents}</p>
            </li>
          ))}
        </ol>
      )}
      <div className="comment-actions" hidden={collapsed}>
        <label className="props-field">
          <span>Status</span>
          <select
            aria-label="Review status"
            value={thread.status}
            onChange={(e) => setStatus(e.target.value as ReviewStatus)}
          >
            {REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="props-field">
          <input type="checkbox" checked={thread.marked} onChange={toggleMark} /> Marked
        </label>
        <button type="button" onClick={() => setReplying((r) => !r)}>
          Reply
        </button>
      </div>
      {replying && !collapsed && (
        <div className="reply-box">
          <textarea
            aria-label="Reply"
            autoFocus
            rows={2}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendReply();
            }}
          />
          <button type="button" className="primary" onClick={sendReply}>
            Post reply
          </button>
        </div>
      )}
    </li>
  );
}
