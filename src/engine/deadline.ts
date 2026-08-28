/**
 * Deadlines (SPEC-4 §7.3, non-negotiable 11).
 *
 * Deadlines are the highest-harm numbers on the site: a COBRA election window,
 * an ACA special enrollment period, a benefits-appeal clock. A wrong or uncited
 * one costs a household the benefit itself, so the citation is **structural** —
 * `Deadline.citation` is non-optional, which makes "I forgot to cite it" a
 * compile error rather than a review miss.
 *
 * The module is pure. Rendering lives in `ui/deadline.ts`, which is the single
 * path any deadline reaches the screen through, so the source link and the
 * staleness treatment cannot be forgotten either.
 *
 * `asOf` is always an explicit parameter, never `Date.now()`. The clock is an
 * *input*: it is displayed on screen and encoded in the deep link, so a deadline
 * view stays reproducible and the determinism contract (SPEC §2 principle 1) is
 * kept honestly rather than quietly bent.
 */
import type { CitationData } from "../data/schemas";

/** When a deadline falls: a fixed date, or a window counted from a trigger. */
export type DeadlineDue =
  /** A fixed calendar date, ISO `YYYY-MM-DD`. */
  | { on: string }
  /** A window of `days` counted from a named event ("the date coverage ended"). */
  | { daysFromTrigger: number; trigger: string };

/** One dated obligation, inseparable from the rule that sets it. */
export interface Deadline {
  /** What must happen, in the user's words ("Elect COBRA coverage"). */
  label: string;
  due: DeadlineDue;
  /** The rule that sets this clock. Non-optional on purpose (SPEC-4 §7.3). */
  citation: CitationData;
  /** Where to act. Free channels only, per the Pillar 4 bar. */
  channel?: { label: string; url: string };
  /**
   * True when a plan, state, or administrator may allow *more* time than this.
   * Rendered as "at least" so a federal floor is never read as a ceiling.
   */
  isFloor?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** Parse an ISO date as UTC midnight; NaN when malformed. */
function parseIsoUtc(iso: string): number {
  if (!ISO_DATE.test(iso)) return NaN;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : NaN;
}

/** Format a UTC timestamp back to an ISO `YYYY-MM-DD`. */
function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Resolve a {@link DeadlineDue} to a concrete date. A window needs the date its
 * trigger occurred; without one it stays unresolved rather than guessing, which
 * is the same "missing data degrades to a banner, never a number" rule the
 * datasets follow (SPEC-3 §2.5).
 */
export function resolveDueDate(due: DeadlineDue, triggerDate?: string): string | null {
  if ("on" in due) return Number.isNaN(parseIsoUtc(due.on)) ? null : due.on;
  if (!triggerDate) return null;
  const start = parseIsoUtc(triggerDate);
  if (Number.isNaN(start)) return null;
  if (!Number.isFinite(due.daysFromTrigger)) return null;
  return toIso(start + Math.trunc(due.daysFromTrigger) * MS_PER_DAY);
}

/** How a deadline stands relative to `asOf`. */
export interface DeadlineStatus {
  /** The resolved due date, or null when a window has no trigger date yet. */
  dueOn: string | null;
  /** Whole days from `asOf` to `dueOn`; negative once past. Null if unresolved. */
  daysRemaining: number | null;
  state: "unresolved" | "past" | "today" | "soon" | "upcoming";
}

/** Days at or under which a deadline is "soon" — the point it leads the list. */
export const SOON_DAYS = 30;

/**
 * Classify a deadline against an explicit `asOf` date. Pure: same inputs, same
 * output, no clock read. A malformed `asOf` yields "unresolved" rather than
 * throwing, so a hostile deep link degrades instead of breaking the page
 * (SPEC-3 §2.1).
 */
export function deadlineStatus(
  deadline: Deadline,
  asOf: string,
  triggerDate?: string,
): DeadlineStatus {
  const dueOn = resolveDueDate(deadline.due, triggerDate);
  const now = parseIsoUtc(asOf);
  if (dueOn === null || Number.isNaN(now)) {
    return { dueOn, daysRemaining: null, state: "unresolved" };
  }
  const daysRemaining = Math.round((parseIsoUtc(dueOn) - now) / MS_PER_DAY);
  const state =
    daysRemaining < 0
      ? "past"
      : daysRemaining === 0
        ? "today"
        : daysRemaining <= SOON_DAYS
          ? "soon"
          : "upcoming";
  return { dueOn, daysRemaining, state };
}

/** Sort key: soonest first, unresolved last. Stable for equal deadlines. */
export function byNearness(a: DeadlineStatus, b: DeadlineStatus): number {
  if (a.daysRemaining === null && b.daysRemaining === null) return 0;
  if (a.daysRemaining === null) return 1;
  if (b.daysRemaining === null) return -1;
  return a.daysRemaining - b.daysRemaining;
}
