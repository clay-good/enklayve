/**
 * Citation and provenance primitives — BUILD-SPEC.md §2 principle 5 and §9.
 *
 * Every rule that ships (a tax bracket, a contribution limit, a poverty line)
 * must resolve to a non-empty citation. No orphan numbers are allowed to ship.
 * `Cited<T>` pairs any value with the public source it came from, and
 * {@link assertCited} is the gate that enforces "no value without a citation".
 */

/**
 * The provenance of a single figure: where it came from, when, and a content
 * hash so a stale or tampered source is detectable. Mirrors the fields the
 * refresh workflow records for every dataset (BUILD-SPEC.md §7).
 */
export interface Citation {
  /** Canonical public URL of the source document. */
  readonly sourceUrl: string;
  /** Human-readable name of the source document (e.g. "IRS Rev. Proc. 2024-40"). */
  readonly sourceDocument: string;
  /** Tax/benefit year the figure is effective for. */
  readonly effectiveYear: number;
  /** ISO-8601 date the value was retrieved from the source (YYYY-MM-DD). */
  readonly dateRetrieved: string;
  /** Content hash (sha256 hex) of the source shard this figure came from. */
  readonly contentHash: string;
}

/** A value paired with its {@link Citation}. */
export interface Cited<T> {
  readonly value: T;
  readonly citation: Citation;
}

/** Pair a value with a citation. */
export function cite<T>(value: T, citation: Citation): Cited<T> {
  return { value, citation };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Return the list of reasons a citation is invalid. Empty array means the
 * citation is complete. Used by both {@link assertCited} and the build-time
 * provenance audit (BUILD-SPEC.md §9).
 */
export function citationProblems(citation: Citation | undefined | null): string[] {
  const problems: string[] = [];
  if (!citation) return ["citation is missing"];
  if (!citation.sourceUrl.trim()) problems.push("sourceUrl is empty");
  if (!citation.sourceDocument.trim()) problems.push("sourceDocument is empty");
  if (!Number.isInteger(citation.effectiveYear) || citation.effectiveYear < 1900) {
    problems.push(`effectiveYear is invalid: ${citation.effectiveYear}`);
  }
  if (!ISO_DATE.test(citation.dateRetrieved)) {
    problems.push(`dateRetrieved is not an ISO date: ${citation.dateRetrieved}`);
  }
  if (!citation.contentHash.trim()) problems.push("contentHash is empty");
  return problems;
}

/** True when the citation carries every required, non-empty field. */
export function isCited(citation: Citation | undefined | null): boolean {
  return citationProblems(citation).length === 0;
}

/**
 * Assert that a value carries a complete citation, returning the unwrapped
 * value. Throws when any citation field is empty or malformed — this is the
 * "no orphan numbers ship" guarantee from BUILD-SPEC.md §9.
 */
export function assertCited<T>(cited: Cited<T>, label = "value"): T {
  const problems = citationProblems(cited?.citation);
  if (problems.length > 0) {
    throw new Error(`Uncited ${label}: ${problems.join("; ")}`);
  }
  return cited.value;
}
