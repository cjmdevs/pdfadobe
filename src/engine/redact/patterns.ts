// Search & Redact patterns (Phase 5). Pure string matching: no PDFium, no DOM.
//
// Patterns err on the side of finding too much: every hit goes to the review panel,
// where a person accepts or rejects it. Matched text never goes to the log.

export type PatternId =
  "ssn" | "itin" | "ein" | "routing" | "account" | "phone" | "email" | "dob" | "date";

export interface PatternInfo {
  id: PatternId;
  label: string;
  /** Shown under the checkbox: what it finds and what it skips. */
  help: string;
  /** Ticked when the Search & Redact panel opens. */
  defaultOn: boolean;
}

export const PATTERNS: readonly PatternInfo[] = [
  {
    id: "ssn",
    label: "Social Security numbers",
    help: "123-45-6789 or 123 45 6789, and 9 digits right after an SSN label",
    defaultOn: true,
  },
  {
    id: "itin",
    label: "ITINs",
    help: "9XX-7X-XXXX style numbers (starts with 9, middle 50-65, 70-88, 90-92, 94-99)",
    defaultOn: true,
  },
  { id: "ein", label: "EINs", help: "12-3456789", defaultOn: true },
  {
    id: "routing",
    label: "Bank routing numbers",
    help: "9 digits that pass the ABA check digit",
    defaultOn: true,
  },
  {
    id: "account",
    label: "Bank account numbers",
    help: "4-17 digits after an account label (Account, Acct, A/C)",
    defaultOn: true,
  },
  { id: "phone", label: "Phone numbers", help: "(555) 555-0100, 555-555-0100", defaultOn: false },
  { id: "email", label: "Email addresses", help: "name@example.com", defaultOn: false },
  {
    id: "dob",
    label: "Dates of birth",
    help: "a date after a birth label (DOB, Date of birth, Born)",
    defaultOn: true,
  },
  {
    id: "date",
    label: "Any date",
    help: "every date on the page; tax documents have many, so this is off by default",
    defaultOn: false,
  },
];

/** A match in a page's text: [start, end) code-unit offsets. */
export interface TextMatch {
  start: number;
  end: number;
  /** Which rule found it; "literal" and "regex" for the user's own searches. */
  source: PatternId | "literal" | "regex";
}

// Digits not glued to other digits (so "1234-56-78901" is not an SSN).
const ND = "(?<![\\d])";
const NA = "(?![\\d])";

const MONTHS =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|" +
  "Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const DATE =
  `(?:\\d{1,2}[/.-]\\d{1,2}[/.-](?:\\d{4}|\\d{2})` +
  `|\\d{4}-\\d{1,2}-\\d{1,2}` +
  `|(?:${MONTHS})\\.? \\d{1,2},? \\d{4}` +
  `|\\d{1,2} (?:${MONTHS})\\.? \\d{4})`;

/** ITIN middle group (IRS ranges). */
function isItinGroup(g: number): boolean {
  return (g >= 50 && g <= 65) || (g >= 70 && g <= 88) || (g >= 90 && g <= 92) || g >= 94;
}

/** ABA routing check digit: 3(d1+d4+d7) + 7(d2+d5+d8) + (d3+d6+d9) is a multiple of 10. */
export function abaValid(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const d = [...digits].map(Number) as number[];
  const at = (i: number) => d[i] ?? 0;
  const sum = 3 * (at(0) + at(3) + at(6)) + 7 * (at(1) + at(4) + at(7)) + (at(2) + at(5) + at(8));
  if (sum % 10 !== 0) return false;
  // First two digits: Federal Reserve district (00-12), thrift (21-32), electronic
  // (61-72) or traveler's checks (80).
  const p = Number(digits.slice(0, 2));
  return p <= 12 || (p >= 21 && p <= 32) || (p >= 61 && p <= 72) || p === 80;
}

function all(re: RegExp, text: string, fn: (m: RegExpExecArray) => TextMatch | null): TextMatch[] {
  const out: TextMatch[] = [];
  for (const m of text.matchAll(re)) {
    const hit = fn(m as RegExpExecArray);
    if (hit && hit.end > hit.start) out.push(hit);
  }
  return out;
}

/** The match of capture group 1, which `d` flag regexes report as `indices[1]`. */
function group1(m: RegExpExecArray, source: TextMatch["source"]): TextMatch | null {
  const span = m.indices?.[1];
  return span ? { start: span[0], end: span[1], source } : null;
}

function findPattern(id: PatternId, text: string): TextMatch[] {
  switch (id) {
    case "ssn":
    case "itin": {
      // SSN takes every NNN-NN-NNNN (an ITIN looks the same; unticking ITINs must not
      // let them through); ITIN takes only the ITIN-shaped ones.
      const out = all(new RegExp(`${ND}(\\d{3})([- ])(\\d{2})\\2(\\d{4})${NA}`, "g"), text, (m) => {
        const itin = m[1]?.startsWith("9") === true && isItinGroup(Number(m[3]));
        if (id === "itin" && !itin) return null;
        return { start: m.index, end: m.index + m[0].length, source: itin ? "itin" : "ssn" };
      });
      if (id === "ssn") {
        // Unformatted 9 digits only right after a label: alone they collide with EINs,
        // routing numbers and invoice numbers.
        const labelled = new RegExp(
          `\\b(?:SSN|S\\.S\\.N\\.|Social Security(?: No\\.?| Number| #)?|TIN)\\s*[:#]?\\s*${ND}(\\d{9})${NA}`,
          "gid",
        );
        out.push(...all(labelled, text, (m) => group1(m, "ssn")));
      }
      return out;
    }
    case "ein":
      return all(new RegExp(`${ND}\\d{2}-\\d{7}${NA}`, "g"), text, (m) => ({
        start: m.index,
        end: m.index + m[0].length,
        source: "ein",
      }));
    case "routing":
      return all(new RegExp(`${ND}\\d{9}${NA}`, "g"), text, (m) =>
        abaValid(m[0]) ? { start: m.index, end: m.index + m[0].length, source: "routing" } : null,
      );
    case "account":
      return all(
        new RegExp(
          `\\b(?:Account|Acct|A/C)\\.?\\s*(?:No\\.?|Number|#)?\\s*[:#]?\\s*${ND}([*Xx\\d][*Xx\\d -]{2,22}\\d)${NA}`,
          "gid",
        ),
        text,
        (m) => {
          const digits = (m[1] ?? "").replace(/\D/g, "");
          return digits.length >= 4 && digits.length <= 17 ? group1(m, "account") : null;
        },
      );
    case "phone":
      return all(
        new RegExp(
          `${ND}(?:\\+?1[-. ]?)?(?:\\(\\d{3}\\) ?|\\d{3}[-. ])\\d{3}[-. ]\\d{4}${NA}`,
          "g",
        ),
        text,
        (m) => ({ start: m.index, end: m.index + m[0].length, source: "phone" }),
      );
    case "email":
      return all(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, text, (m) => ({
        start: m.index,
        end: m.index + m[0].length,
        source: "email",
      }));
    case "dob":
      return all(
        new RegExp(
          `\\b(?:D\\.?O\\.?B\\.?|Date of Birth|Birth ?date|Born)\\s*[:#]?\\s*(${DATE})${NA}`,
          "gid",
        ),
        text,
        (m) => group1(m, "dob"),
      );
    case "date":
      return all(new RegExp(`${ND}${DATE}${NA}`, "gi"), text, (m) => ({
        start: m.index,
        end: m.index + m[0].length,
        source: "date",
      }));
  }
}

export interface SearchSpec {
  patterns?: PatternId[];
  /** Plain text to find. */
  literals?: string[];
  /** Case-sensitive literal match. Default false. */
  matchCase?: boolean;
  /** Literal only when not inside a longer word. Default false. */
  wholeWord?: boolean;
  /** The user's own regular expressions (JavaScript syntax). */
  regexes?: { source: string; ignoreCase?: boolean }[];
}

/** Why a user regex cannot run, or null when it is fine. */
export function regexError(source: string): string | null {
  if (!source) return "Enter a pattern.";
  try {
    const re = new RegExp(source, "g");
    if (re.test("")) return "This pattern matches empty text; it would mark nothing useful.";
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every match in `text`, sorted, with exact duplicates (same span) removed. */
export function findMatches(text: string, spec: SearchSpec): TextMatch[] {
  const out: TextMatch[] = [];
  for (const id of spec.patterns ?? []) out.push(...findPattern(id, text));
  for (const lit of spec.literals ?? []) {
    if (!lit.trim()) continue;
    // Whitespace in the search matches any run of whitespace on the page (PDFium
    // inserts generated spaces and line breaks between words).
    let body = lit.trim().split(/\s+/).map(escapeRegex).join("\\s+");
    if (spec.wholeWord) body = `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`;
    const re = new RegExp(body, spec.matchCase ? "gu" : "giu");
    out.push(
      ...all(re, text, (m) => ({ start: m.index, end: m.index + m[0].length, source: "literal" })),
    );
  }
  for (const r of spec.regexes ?? []) {
    if (regexError(r.source)) continue;
    const re = new RegExp(r.source, r.ignoreCase ? "gi" : "g");
    out.push(
      ...all(re, text, (m) => ({ start: m.index, end: m.index + m[0].length, source: "regex" })),
    );
  }
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  return out.filter((m, i) => {
    const prev = out[i - 1];
    return !prev || prev.start !== m.start || prev.end !== m.end;
  });
}
