// Comments list (Phase 3): annotations grouped into threads (replies point at their
// parent with /IRT) with Acrobat-style review status, plus filtering. No React here.

import {
  PdfAnnotationReplyType,
  PdfAnnotationState,
  PdfAnnotationStateModel,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
} from "@embedpdf/models";

/** Shown in the list; links, form fields, popups and redaction marks are not comments. */
const LISTED = new Set<PdfAnnotationSubtype>([
  PdfAnnotationSubtype.TEXT,
  PdfAnnotationSubtype.FREETEXT,
  PdfAnnotationSubtype.HIGHLIGHT,
  PdfAnnotationSubtype.UNDERLINE,
  PdfAnnotationSubtype.STRIKEOUT,
  PdfAnnotationSubtype.SQUIGGLY,
  PdfAnnotationSubtype.SQUARE,
  PdfAnnotationSubtype.CIRCLE,
  PdfAnnotationSubtype.LINE,
  PdfAnnotationSubtype.POLYLINE,
  PdfAnnotationSubtype.POLYGON,
  PdfAnnotationSubtype.INK,
  PdfAnnotationSubtype.STAMP,
  PdfAnnotationSubtype.CARET,
]);

export function typeLabel(a: Pick<PdfAnnotationObject, "type" | "intent"> & object): string {
  const cloudy = ((a as { cloudyBorderIntensity?: number }).cloudyBorderIntensity ?? 0) > 0;
  switch (a.type) {
    case PdfAnnotationSubtype.TEXT:
      return "Sticky note";
    case PdfAnnotationSubtype.FREETEXT:
      return a.intent === "FreeTextCallout" ? "Callout" : "Text box";
    case PdfAnnotationSubtype.HIGHLIGHT:
      return "Highlight";
    case PdfAnnotationSubtype.UNDERLINE:
      return "Underline";
    case PdfAnnotationSubtype.STRIKEOUT:
      return "Strikethrough";
    case PdfAnnotationSubtype.SQUIGGLY:
      return "Squiggly";
    case PdfAnnotationSubtype.SQUARE:
      return cloudy ? "Cloud" : "Rectangle";
    case PdfAnnotationSubtype.CIRCLE:
      return cloudy ? "Cloud" : "Ellipse";
    case PdfAnnotationSubtype.LINE:
      return a.intent === "LineArrow" ? "Arrow" : "Line";
    case PdfAnnotationSubtype.POLYLINE:
      return "Polyline";
    case PdfAnnotationSubtype.POLYGON:
      return cloudy ? "Cloud" : "Polygon";
    case PdfAnnotationSubtype.INK:
      return "Drawing";
    case PdfAnnotationSubtype.STAMP:
      return "Stamp";
    case PdfAnnotationSubtype.CARET:
      return "Inserted text";
    default:
      return "Annotation";
  }
}

/** The color a reviewer would call "its color" (text color for text boxes). */
export function colorOf(a: PdfAnnotationObject): string | null {
  const o = a as unknown as Record<string, unknown>;
  const pick = a.type === PdfAnnotationSubtype.FREETEXT ? o.fontColor : (o.strokeColor ?? o.color);
  return typeof pick === "string" && pick.startsWith("#") ? pick.toUpperCase() : null;
}

export type ReviewStatus = "None" | "Accepted" | "Rejected" | "Cancelled" | "Completed";
export const REVIEW_STATUSES: ReviewStatus[] = [
  "None",
  "Accepted",
  "Rejected",
  "Cancelled",
  "Completed",
];

export interface CommentThread {
  annotation: PdfAnnotationObject;
  /** Text replies, oldest first. */
  replies: PdfAnnotationObject[];
  /** Latest review status set on it (any author), or "None". */
  status: ReviewStatus;
  /** Marked with a check mark (Acrobat's "Marked" state). */
  marked: boolean;
}

const isState = (a: PdfAnnotationObject) =>
  a.type === PdfAnnotationSubtype.TEXT && (a as { stateModel?: unknown }).stateModel !== undefined;

const time = (a: PdfAnnotationObject) => (a.modified ?? a.created)?.getTime() ?? 0;

/** Threads in reading order (page, then top to bottom). */
export function buildThreads(all: PdfAnnotationObject[]): CommentThread[] {
  const byId = new Map(all.map((a) => [a.id, a]));
  const children = new Map<string, PdfAnnotationObject[]>();
  for (const a of all) {
    // Replies and states hang under their parent; grouped members (RT /Group) are
    // parts of one object and are not listed separately either.
    if (a.inReplyToId && byId.has(a.inReplyToId)) {
      const list = children.get(a.inReplyToId) ?? [];
      list.push(a);
      children.set(a.inReplyToId, list);
    }
  }
  const threads: CommentThread[] = [];
  for (const a of all) {
    if (a.inReplyToId && byId.has(a.inReplyToId)) continue;
    if (!LISTED.has(a.type)) continue;
    const kids = (children.get(a.id) ?? []).sort((x, y) => time(x) - time(y));
    const states = kids.filter(isState);
    const review = states.filter(
      (s) => (s as { stateModel?: string }).stateModel === PdfAnnotationStateModel.Review,
    );
    const marks = states.filter(
      (s) => (s as { stateModel?: string }).stateModel === PdfAnnotationStateModel.Marked,
    );
    const lastReview = review.at(-1) as { state?: string } | undefined;
    const lastMark = marks.at(-1) as { state?: string } | undefined;
    threads.push({
      annotation: a,
      replies: kids.filter(
        (k) =>
          !isState(k) &&
          (k.replyType === undefined || k.replyType === PdfAnnotationReplyType.Reply),
      ),
      status: REVIEW_STATUSES.includes(lastReview?.state as ReviewStatus)
        ? (lastReview?.state as ReviewStatus)
        : "None",
      marked: lastMark?.state === PdfAnnotationState.Marked,
    });
  }
  return threads.sort(
    (x, y) =>
      x.annotation.pageIndex - y.annotation.pageIndex ||
      x.annotation.rect.origin.y - y.annotation.rect.origin.y ||
      x.annotation.rect.origin.x - y.annotation.rect.origin.x,
  );
}

export interface CommentFilter {
  type: string | null;
  author: string | null;
  color: string | null;
  status: ReviewStatus | null;
}

export const NO_FILTER: CommentFilter = { type: null, author: null, color: null, status: null };

export function filterThreads(threads: CommentThread[], f: CommentFilter): CommentThread[] {
  return threads.filter(
    (t) =>
      (!f.type || typeLabel(t.annotation) === f.type) &&
      (!f.author ||
        t.annotation.author === f.author ||
        t.replies.some((r) => r.author === f.author)) &&
      (!f.color || colorOf(t.annotation) === f.color) &&
      (!f.status || t.status === f.status),
  );
}

/** Comments whose text, replies, author, type or subject contain `query` (any case). */
export function searchThreads(threads: CommentThread[], query: string): CommentThread[] {
  const q = query.trim().toLowerCase();
  if (!q) return threads;
  const has = (v: string | null | undefined) => !!v && v.toLowerCase().includes(q);
  return threads.filter((t) => {
    const a = t.annotation;
    return (
      has(a.contents) ||
      has(a.author) ||
      has(typeLabel(a)) ||
      has((a as { subject?: string }).subject) ||
      t.replies.some((r) => has(r.contents) || has(r.author))
    );
  });
}

/** Acrobat's sort orders for the comments list. */
export type CommentSort = "page" | "author" | "date" | "type" | "color";
export const COMMENT_SORTS: readonly { id: CommentSort; label: string }[] = [
  { id: "page", label: "Page" },
  { id: "author", label: "Author" },
  { id: "date", label: "Date" },
  { id: "type", label: "Type" },
  { id: "color", label: "Color" },
];

/** Threads in `by` order; ties stay in reading order (threads come in page order). */
export function sortThreads(threads: CommentThread[], by: CommentSort): CommentThread[] {
  if (by === "page") return threads;
  const key = (t: CommentThread): string | number => {
    const a = t.annotation;
    if (by === "author") return (a.author ?? "").toLowerCase();
    if (by === "date") return -time(a);
    if (by === "type") return typeLabel(a);
    return colorOf(a) ?? "~";
  };
  return [...threads].sort((p, q) => {
    const x = key(p);
    const y = key(q);
    return typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y));
  });
}

/** Choices for the filter menus, from what is in the document. */
export function filterChoices(threads: CommentThread[]) {
  const uniq = (xs: (string | null | undefined)[]) =>
    [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  return {
    types: uniq(threads.map((t) => typeLabel(t.annotation))),
    authors: uniq(threads.flatMap((t) => [t.annotation.author, ...t.replies.map((r) => r.author)])),
    colors: uniq(threads.map((t) => colorOf(t.annotation))),
  };
}

/** A reply to `parent` (a /Text annotation with /IRT, not shown on the page). */
export function newReply(
  parent: PdfAnnotationObject,
  contents: string,
  author: string,
  now = new Date(),
): PdfAnnotationObject {
  return {
    type: PdfAnnotationSubtype.TEXT,
    id: crypto.randomUUID(),
    pageIndex: parent.pageIndex,
    rect: parent.rect,
    contents,
    author,
    created: now,
    modified: now,
    inReplyToId: parent.id,
    replyType: PdfAnnotationReplyType.Reply,
    flags: ["print", "noView", "noZoom", "noRotate"],
  };
}

/** A review/marked state on `parent`, as Acrobat writes it (hidden /Text with /IRT). */
export function newState(
  parent: PdfAnnotationObject,
  model: "Review" | "Marked",
  state: string,
  author: string,
  now = new Date(),
): PdfAnnotationObject {
  return {
    type: PdfAnnotationSubtype.TEXT,
    id: crypto.randomUUID(),
    pageIndex: parent.pageIndex,
    rect: parent.rect,
    contents: `${state} set by ${author}`,
    author,
    created: now,
    modified: now,
    inReplyToId: parent.id,
    replyType: PdfAnnotationReplyType.Reply,
    state: state as PdfAnnotationState,
    stateModel: model as PdfAnnotationStateModel,
    flags: ["hidden", "noView", "noZoom", "noRotate", "print"],
  } as PdfAnnotationObject;
}
