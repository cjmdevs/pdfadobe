// Comments panel (Phase 3): every comment with author, date and page; filters; reply
// threads; review status; click to jump. Comment text never reaches a log (CLAUDE.md).
import { useMemo, useState } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { PdfAnnotationSubtype, type PdfAnnotationObject } from "@embedpdf/models";
import { useWorkbench } from "../../app/workbench";
import {
  NO_FILTER,
  REVIEW_STATUSES,
  buildThreads,
  colorOf,
  filterChoices,
  filterThreads,
  newReply,
  newState,
  typeLabel,
  type CommentFilter,
  type CommentThread,
  type ReviewStatus,
} from "../../markup/comments";
import { Icon } from "../Icon";

const when = (a: PdfAnnotationObject) => {
  const d = a.modified ?? a.created;
  return d ? d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "";
};

export function CommentsPanel({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const { provides: scope, state } = useAnnotation(documentId);
  const { provides: scroll } = useScroll(documentId);
  const [filter, setFilter] = useState<CommentFilter>(NO_FILTER);

  const all = useMemo(() => Object.values(state.byUid).map((t) => t.object), [state.byUid]);
  const threads = useMemo(() => buildThreads(all), [all]);
  const choices = useMemo(() => filterChoices(threads), [threads]);
  const shown = filterThreads(threads, filter);
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

  return (
    <aside className="comments-panel" aria-label="Comments" data-testid="comments-panel">
      <header className="panel-header">
        <h2>Comments ({threads.length})</h2>
        <button
          type="button"
          className="tool"
          aria-label="Close comments"
          onClick={() => wb.updateSettings({ commentsOpen: false })}
        >
          <Icon name="close" />
        </button>
      </header>
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
      </div>
      {shown.length === 0 ? (
        <p className="hint">
          {threads.length ? "No comments match the filter." : "No comments yet."}
        </p>
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
            />
          ))}
        </ol>
      )}
    </aside>
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
}: {
  thread: CommentThread;
  selected: boolean;
  onJump: () => void;
  author: string;
  scope: Scope;
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
        {color && <span className="swatch" style={{ background: color }} aria-hidden="true" />}
        <span className="comment-type">{typeLabel(a)}</span>
        <span className="comment-author">{a.author || "Unknown"}</span>
        <span className="comment-meta">
          p. {a.pageIndex + 1} · {when(a)}
        </span>
      </button>
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
      {thread.replies.length > 0 && (
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
      <div className="comment-actions">
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
      {replying && (
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
