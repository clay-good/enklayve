/**
 * The IRC §6654 rules a 1040-ES filer needs: when the four installments are due,
 * and how much of the year's tax has to be paid across them to escape the
 * underpayment penalty.
 *
 * The calendar (SPEC-3 §4.2): the four installments for a tax year are
 * statutorily due April 15, June 15, September 15, and January 15 of the
 * following year — but when a date falls on a weekend or a legal holiday
 * (including DC's Emancipation Day, which the IRS observes), it moves to the
 * next business day. This is a pure, deterministic function of the tax year:
 * same year in, same four dates out, no clock read.
 *
 * The safe harbor is §6654(d)(1)(B)–(C) and lives here beside it because it is
 * the same statute answering the same person's question, and because it had
 * been living on a tile as two literals instead.
 */
import { Money } from "./money";
import type { FilingStatus } from "../data/schemas";

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

/**
 * Prior-year AGI above which the safe harbor rises from 100% to 110% of last
 * year's tax — IRC §6654(d)(1)(C)(i).
 *
 * Statutory and never indexed: $150,000 since the Omnibus Budget Reconciliation
 * Act of 1993, so there is no annual figure to chase and a change would be an
 * act of Congress rather than an adjustment.
 */
export const SAFE_HARBOR_HIGH_AGI = 150_000;

/**
 * The same threshold for a married individual filing separately: **half**.
 *
 * §6654(d)(1)(C)(ii), verbatim: "In the case of a married individual (within the
 * meaning of section 7703) who files a separate return for the taxable year for
 * which the amount of the installment is being determined, clause (i) shall be
 * applied by substituting '$75,000' for '$150,000'."
 *
 * The tile that asked this question applied $150,000 to every filing status, so
 * a separate filer whose prior-year AGI was between $75,000 and $150,000 was
 * told that 100% of last year's tax was enough. It is not; the statute wants
 * 110%, and the gap is an underpayment penalty under §6654 printed on the one
 * line whose entire purpose is avoiding it. Wrong in the reassuring direction,
 * which is the direction that costs somebody money.
 */
export const SAFE_HARBOR_HIGH_AGI_SEPARATE = 75_000;

/** Share of the *current* year's tax that is always a safe harbor — §6654(d)(1)(B)(i). */
const CURRENT_YEAR_SHARE = 0.9;

/** Multiple of last year's tax that is a safe harbor — §6654(d)(1)(B)(ii), "100 percent". */
const PRIOR_YEAR_SHARE = 1;

/** What subparagraph (C)(i) substitutes for it above the threshold: "110 percent". */
const PRIOR_YEAR_SHARE_HIGH_AGI = 1.1;

/** The prior-year AGI threshold that applies to one filing status. */
export function safeHarborAgiThreshold(filingStatus: FilingStatus): number {
  return filingStatus === "married_separately"
    ? SAFE_HARBOR_HIGH_AGI_SEPARATE
    : SAFE_HARBOR_HIGH_AGI;
}

export interface SafeHarbor {
  /** The least the year's payments may total without a §6654 penalty. */
  minimum: Money;
  /** 1 or 1.1 — the multiple of last year's tax this filer must reach. */
  priorYearRate: number;
  /** The threshold that produced that rate, for a line that can explain itself. */
  threshold: number;
  /** Which of the two tests was the smaller, and therefore binding. */
  basis: "prior-year" | "current-year";
}

/**
 * The smaller of the two §6654(d)(1)(B) tests, which is the one that binds.
 *
 * (i) 90% of the tax shown on this year's return, or (ii) 100% of the tax shown
 * on last year's — raised to 110% by subparagraph (C) when last year's AGI was
 * over the threshold.
 *
 * `priorYearAgi` is **last year's**, not this year's. The statute says "the
 * adjusted gross income shown on the return of the individual for the preceding
 * taxable year", and a self-employed person's AGI is exactly the number that
 * swings between the two — someone whose business doubled this year would have
 * been charged 110% on the strength of a year they had not filed yet, and
 * someone whose business halved would have been told 100% when last year's
 * return says otherwise.
 */
export function estimatedTaxSafeHarbor(
  filingStatus: FilingStatus,
  priorYearTax: Money,
  priorYearAgi: number,
  currentYearTax: Money,
): SafeHarbor {
  const threshold = safeHarborAgiThreshold(filingStatus);
  // "Exceeds" — a filer standing exactly on $150,000 (or $75,000 separately) is
  // on the 100% side of it.
  const priorYearRate = priorYearAgi > threshold ? PRIOR_YEAR_SHARE_HIGH_AGI : PRIOR_YEAR_SHARE;
  const byPriorYear = priorYearTax.multiply(priorYearRate);
  const byCurrentYear = currentYearTax.multiply(CURRENT_YEAR_SHARE);
  const priorBinds = byPriorYear.lessThan(byCurrentYear);
  return {
    minimum: priorBinds ? byPriorYear : byCurrentYear,
    priorYearRate,
    threshold,
    basis: priorBinds ? "prior-year" : "current-year",
  };
}
