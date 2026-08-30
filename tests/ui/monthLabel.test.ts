import { describe, it, expect } from "vitest";
import { monthsAheadLabel } from "../../src/ui/deadline";
import { addCalendarMonths } from "../../src/engine/deadline";

/**
 * The payoff tiles' "freedom date" label.
 *
 * Both tiles carried their own copy built on `d.setMonth(d.getMonth() + n)`,
 * which overflows instead of clamping — one month from January 31 builds
 * February 31, the Date rolls into March, and the label reads the month after
 * next. A plausible wrong month is the kind nobody double-checks.
 */
describe("a calendar label months ahead", () => {
  it("clamps at a month end instead of rolling into the next month", () => {
    // Every month-end that overflows: 31 days followed by a shorter month.
    expect(monthsAheadLabel(1, "en-US", "2026-01-31")).toBe("February 2026");
    expect(monthsAheadLabel(1, "en-US", "2026-03-31")).toBe("April 2026");
    expect(monthsAheadLabel(1, "en-US", "2026-05-31")).toBe("June 2026");
    expect(monthsAheadLabel(1, "en-US", "2026-08-31")).toBe("September 2026");
    expect(monthsAheadLabel(1, "en-US", "2026-10-31")).toBe("November 2026");
    // And the leap-year edge, which overflows by three days.
    expect(monthsAheadLabel(1, "en-US", "2027-01-31")).toBe("February 2027");
  });

  it("counts whole months from an ordinary day", () => {
    expect(monthsAheadLabel(0, "en-US", "2026-08-30")).toBe("August 2026");
    expect(monthsAheadLabel(6, "en-US", "2026-08-30")).toBe("February 2027");
    expect(monthsAheadLabel(18, "en-US", "2026-08-30")).toBe("February 2028");
    expect(monthsAheadLabel(120, "en-US", "2026-08-30")).toBe("August 2036");
  });

  it("crosses the year boundary without drifting", () => {
    expect(monthsAheadLabel(1, "en-US", "2026-12-31")).toBe("January 2027");
    expect(monthsAheadLabel(2, "en-US", "2026-12-31")).toBe("February 2027");
  });
});

describe("adding calendar months", () => {
  it("lands on the last day of a shorter month", () => {
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addCalendarMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addCalendarMonths("2026-01-31", 3)).toBe("2026-04-30");
  });

  it("leaves a day that exists in the target month alone", () => {
    expect(addCalendarMonths("2026-08-30", 6)).toBe("2027-02-28");
    expect(addCalendarMonths("2026-08-15", 6)).toBe("2027-02-15");
    expect(addCalendarMonths("2026-08-15", 0)).toBe("2026-08-15");
  });

  it("counts backwards too", () => {
    expect(addCalendarMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addCalendarMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("hands back a malformed date rather than inventing one", () => {
    expect(addCalendarMonths("not-a-date", 1)).toBe("not-a-date");
  });

  it("never throws, however absurd the count (§2.9)", () => {
    // A count far enough out lands past the range a Date can hold, and
    // `toISOString` answers that by throwing. Nothing reaches it today — a
    // payoff is capped at 1,200 months — but "no public function throws" is a
    // property of the function, not of today's callers.
    for (const months of [Infinity, -Infinity, NaN, 1e9, 1e15, Number.MAX_SAFE_INTEGER]) {
      expect(() => addCalendarMonths("2026-08-30", months)).not.toThrow();
      expect(addCalendarMonths("2026-08-30", months)).toBe("2026-08-30");
      expect(() => monthsAheadLabel(months, "en-US", "2026-08-30")).not.toThrow();
    }
    // A large-but-representable count still answers properly.
    expect(addCalendarMonths("2026-08-30", 1200)).toBe("2126-08-30");
  });
});
