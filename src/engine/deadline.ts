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
  | { daysFromTrigger: number; trigger: string }
  /**
   * A window counted in *calendar months*, because some rules are written that
   * way and converting them to days would be wrong rather than merely
   * imprecise: Medicare's initial enrollment period is "3 months before ...
   * through 3 months after that first month of eligibility" (42 CFR §407.14),
   * and its Part B special enrollment period ends "on the last day of the
   * eighth consecutive month" (42 CFR §406.24). Three months is 89, 90, 91, or
   * 92 days depending on where in the year it falls, and the difference is
   * whether someone enrolls in time.
   */
  | { monthsFromTrigger: number; trigger: string };

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
  if ("monthsFromTrigger" in due) {
    if (!Number.isFinite(due.monthsFromTrigger)) return null;
    return addCalendarMonths(toIso(start), Math.trunc(due.monthsFromTrigger));
  }
  if (!Number.isFinite(due.daysFromTrigger)) return null;
  return toIso(start + Math.trunc(due.daysFromTrigger) * MS_PER_DAY);
}

/**
 * Add whole calendar months to an ISO date, clamping to the end of the target
 * month. Clamping is what makes the month form usable for the rules that need
 * it: a period counted from the last day of a month lands on the last day of the
 * later month, whatever its length — January 31 plus three months is April 30,
 * not May 1.
 *
 * The native alternative, `d.setMonth(d.getMonth() + n)`, overflows instead of
 * clamping: it builds February 31 and lets the Date roll forward into March, so
 * the answer is a month later than asked for. Every tile that projects a date
 * forward uses this, because a label reading "March 2026" for one month from
 * January 31 is wrong in a way nobody double-checks.
 */
export function addCalendarMonths(iso: string, months: number): string {
  const startMs = parseIsoUtc(iso);
  if (!Number.isFinite(startMs) || !Number.isFinite(months)) return iso;
  const d = new Date(startMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(year, month + Math.trunc(months), 1));
  // A count far enough out lands past the range a Date can hold, and
  // `toISOString` answers that by throwing — the one way this function could
  // break the §2.9 rule that no public function throws. Nothing reaches it
  // today (a payoff is capped at 1,200 months), which is exactly why it is
  // worth pinning now rather than after some later caller finds it.
  if (Number.isNaN(target.getTime())) return iso;
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const result = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay));
  return Number.isNaN(result) ? iso : toIso(result);
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
