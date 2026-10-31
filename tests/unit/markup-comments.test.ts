import { describe, expect, it } from "vitest";
import { PdfAnnotationSubtype, type PdfAnnotationObject } from "@embedpdf/models";
import {
  NO_FILTER,
  buildThreads,
  filterChoices,
  filterThreads,
  newReply,
  newState,
  searchThreads,
  sortThreads,
  typeLabel,
} from "../../src/markup/comments";
import { SAMPLES } from "../helpers/markup-samples";

const samples = SAMPLES.map((s) => s.anno);
const note = samples.find((a) => a.id === "note")!;
const t = (iso: string) => new Date(iso);

describe("comments list", () => {
  it("search finds text, replies and types; sort orders by type and keeps page order", () => {
    const threads = buildThreads([
      ...samples,
      newReply(note, "Tied to TB", "Second Reviewer", t("2026-10-23T10:00:00Z")),
    ]);
    expect(searchThreads(threads, "tied to").map((x) => x.annotation.id)).toEqual(["note"]);
    expect(searchThreads(threads, "STICKY").map((x) => x.annotation.id)).toContain("note");
    expect(searchThreads(threads, "  ")).toBe(threads);
    const byType = sortThreads(threads, "type").map((x) => typeLabel(x.annotation));
    expect(byType).toEqual([...byType].sort((a, b) => a.localeCompare(b)));
    expect(sortThreads(threads, "page")).toBe(threads);
  });

  it("lists every markup sample once, in page then top-to-bottom order", () => {
    const threads = buildThreads(samples);
    expect(threads).toHaveLength(samples.length);
    const ys = threads.map((x) => x.annotation.rect.origin.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it("replies and status hang under their parent; the latest status wins", () => {
    const all: PdfAnnotationObject[] = [
      ...samples,
      newReply(note, "Agreed", "Second Reviewer", t("2026-10-23T10:00:00Z")),
      newState(note, "Review", "Rejected", "Second Reviewer", t("2026-10-23T10:01:00Z")),
      newState(note, "Review", "Accepted", "Partner", t("2026-10-23T10:05:00Z")),
      newState(note, "Marked", "Marked", "Partner", t("2026-10-23T10:06:00Z")),
    ];
    const threads = buildThreads(all);
    expect(threads).toHaveLength(samples.length);
    const thread = threads.find((x) => x.annotation.id === "note")!;
    expect(thread.replies.map((r) => r.contents)).toEqual(["Agreed"]);
    expect(thread.status).toBe("Accepted");
    expect(thread.marked).toBe(true);
  });

  it("filters by type, author (incl. reply authors), color and status", () => {
    const all = [...samples, newReply(note, "ok", "Second Reviewer")];
    const threads = buildThreads(all);
    expect(
      filterThreads(threads, { ...NO_FILTER, type: "Arrow" }).map((x) => x.annotation.id),
    ).toEqual(["arrow"]);
    expect(
      filterThreads(threads, { ...NO_FILTER, author: "Second Reviewer" }).map(
        (x) => x.annotation.id,
      ),
    ).toEqual(["note"]);
    expect(
      filterThreads(threads, { ...NO_FILTER, color: "#FFFF00" }).map((x) => x.annotation.id),
    ).toEqual(["markup-0"]);
    expect(filterThreads(threads, { ...NO_FILTER, status: "Accepted" })).toEqual([]);
    const choices = filterChoices(threads);
    expect(choices.authors).toEqual(["Second Reviewer", "Test Reviewer"]);
    expect(choices.types).toContain("Cloud");
  });

  it("names types the way the toolbar does", () => {
    expect(samples.map((a) => typeLabel(a))).toEqual([
      "Highlight",
      "Underline",
      "Strikethrough",
      "Squiggly",
      "Sticky note",
      "Text box",
      "Callout",
      "Rectangle",
      "Ellipse",
      "Line",
      "Arrow",
      "Polyline",
      "Polygon",
      "Cloud",
      "Drawing",
    ]);
    expect(typeLabel({ type: PdfAnnotationSubtype.LINK })).toBe("Annotation");
  });
});
