import { describe, it, expect } from "vitest";
import {
  byNearness,
  deadlineStatus,
  resolveDueDate,
  SOON_DAYS,
  type Deadline,
} from "../../src/engine/deadline";
import type { CitationData } from "../../src/data/schemas";

/**
 * Deadlines are the highest-harm numbers on the site (SPEC-4 §4, addition 11),
 * so the clock arithmetic is pinned here: windows resolve only when their
 * trigger date is known, a malformed input degrades instead of throwing, and
 * `asOf` is always explicit so the same inputs always give the same answer.
 */
const CITATION: CitationData = {
  sourceUrl: "https://www.dol.gov/agencies/ebsa/laws-and-regulations/laws/cobra",
  sourceDocument: "COBRA continuation coverage (ERISA)",
  effectiveYear: 2026,
  dateRetrieved: "2026-08-28",
};

const fixed = (on: string): Deadline => ({ label: "File the appeal", due: { on }, citation: CITATION });
const window60: Deadline = {
  label: "Elect COBRA coverage",
  due: { daysFromTrigger: 60, trigger: "the date coverage ended" },
  citation: CITATION,
};

describe("resolveDueDate", () => {
  it("returns a fixed date unchanged", () => {
    expect(resolveDueDate({ on: "2026-11-15" })).toBe("2026-11-15");
  });

  it("counts a window forward from its trigger date", () => {
    expect(resolveDueDate({ daysFromTrigger: 60, trigger: "coverage ended" }, "2026-09-01")).toBe(
      "2026-10-31",
    );
  });

  it("stays unresolved when a window has no trigger date, rather than guessing", () => {
    expect(resolveDueDate({ daysFromTrigger: 60, trigger: "coverage ended" })).toBeNull();
  });

  it("rejects a malformed date instead of producing a wrong one", () => {
    expect(resolveDueDate({ on: "11/15/2026" })).toBeNull();
    expect(resolveDueDate({ daysFromTrigger: 60, trigger: "x" }, "not-a-date")).toBeNull();
  });

  it("crosses a month and a leap day correctly", () => {
    expect(resolveDueDate({ daysFromTrigger: 1, trigger: "x" }, "2028-02-28")).toBe("2028-02-29");
    expect(resolveDueDate({ daysFromTrigger: 1, trigger: "x" }, "2026-12-31")).toBe("2027-01-01");
  });
});

describe("deadlineStatus", () => {
  it("classifies today, soon, upcoming, and past against an explicit asOf", () => {
    expect(deadlineStatus(fixed("2026-09-01"), "2026-09-01").state).toBe("today");
    expect(deadlineStatus(fixed("2026-09-10"), "2026-09-01").state).toBe("soon");
    expect(deadlineStatus(fixed("2026-12-01"), "2026-09-01").state).toBe("upcoming");
    expect(deadlineStatus(fixed("2026-08-01"), "2026-09-01").state).toBe("past");
  });

  it("puts the soon/upcoming boundary exactly at SOON_DAYS", () => {
    expect(deadlineStatus(fixed("2026-10-01"), "2026-09-01").daysRemaining).toBe(SOON_DAYS);
    expect(deadlineStatus(fixed("2026-10-01"), "2026-09-01").state).toBe("soon");
    expect(deadlineStatus(fixed("2026-10-02"), "2026-09-01").state).toBe("upcoming");
  });

  it("is unresolved — never wrong — when the window has no trigger", () => {
    const status = deadlineStatus(window60, "2026-09-01");
    expect(status.state).toBe("unresolved");
    expect(status.daysRemaining).toBeNull();
  });

  it("degrades to unresolved on a hostile asOf rather than throwing", () => {
    expect(() => deadlineStatus(fixed("2026-09-01"), "??")).not.toThrow();
    expect(deadlineStatus(fixed("2026-09-01"), "??").state).toBe("unresolved");
  });

  it("is pure: the same inputs always give the same answer", () => {
    const a = deadlineStatus(window60, "2026-09-01", "2026-08-01");
    const b = deadlineStatus(window60, "2026-09-01", "2026-08-01");
    expect(a).toEqual(b);
    expect(a.dueOn).toBe("2026-09-30");
  });
});

describe("byNearness", () => {
  it("sorts soonest first and unresolved last", () => {
    const asOf = "2026-09-01";
    const items = [
      deadlineStatus(window60, asOf),
      deadlineStatus(fixed("2026-12-01"), asOf),
      deadlineStatus(fixed("2026-09-05"), asOf),
    ];
    const sorted = [...items].sort(byNearness);
    expect(sorted.map((s) => s.dueOn)).toEqual(["2026-09-05", "2026-12-01", null]);
  });
});
