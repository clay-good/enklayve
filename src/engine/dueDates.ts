/**
 * Estimated-tax (Form 1040-ES) due-date calendar (SPEC-3 §4.2). The four
 * installments for a tax year are statutorily due April 15, June 15, September 15,
 * and January 15 of the following year — but when a date falls on a weekend or a
 * legal holiday (including DC's Emancipation Day, which the IRS observes), it
 * moves to the next business day. This is a pure, deterministic function of the
 * tax year: same year in, same four dates out, no clock read.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Martin Luther King Jr. Day: the third Monday of January. */
function isMlkDay(d: Date): boolean {
  if (d.getUTCMonth() !== 0 || d.getUTCDay() !== 1) return false;
  const date = d.getUTCDate();
  return date >= 15 && date <= 21;
}

/**
 * The day DC observes Emancipation Day (April 16): the Friday before if the 16th
 * is a Saturday, the Monday after if it is a Sunday, else the 16th itself. The IRS
 * treats it as a holiday for the April deadline.
 */
function emancipationObservedDate(year: number): number {
  const apr16 = new Date(Date.UTC(year, 3, 16));
  const day = apr16.getUTCDay();
  if (day === 6) return 15; // Saturday → observed Friday the 15th
  if (day === 0) return 17; // Sunday → observed Monday the 17th
  return 16;
}

function isHoliday(d: Date): boolean {
  if (isMlkDay(d)) return true;
  if (d.getUTCMonth() === 3 && d.getUTCDate() === emancipationObservedDate(d.getUTCFullYear())) {
    return true;
  }
  return false;
}

/** Advance to the next day that is neither a weekend nor a recognized holiday. */
function nextBusinessDay(d: Date): Date {
  let cur = d;
  while (isWeekend(cur) || isHoliday(cur)) {
    cur = new Date(cur.getTime() + DAY_MS);
  }
  return cur;
}

export interface EstimatedDueDate {
  /** Quarter label, 1–4. */
  quarter: number;
  /** The statutory date before any weekend/holiday adjustment. */
  statutory: Date;
  /** The date the payment is actually due (adjusted to the next business day). */
  due: Date;
  /** True when the weekend/holiday rule moved the date. */
  adjusted: boolean;
}

/** The four 1040-ES installment due dates for `taxYear` (Q4 lands the next January). */
export function estimatedTaxDueDates(taxYear: number): EstimatedDueDate[] {
  const statutory: Date[] = [
    new Date(Date.UTC(taxYear, 3, 15)), // Apr 15
    new Date(Date.UTC(taxYear, 5, 15)), // Jun 15
    new Date(Date.UTC(taxYear, 8, 15)), // Sep 15
    new Date(Date.UTC(taxYear + 1, 0, 15)), // Jan 15 next year
  ];
  return statutory.map((s, i) => {
    const due = nextBusinessDay(s);
    return { quarter: i + 1, statutory: s, due, adjusted: due.getTime() !== s.getTime() };
  });
}

/** Format a UTC date as US prose, e.g. "April 15, 2026". */
export function formatDueDate(d: Date, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}
