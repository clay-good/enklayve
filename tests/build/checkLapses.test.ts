import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lapseFor, lapsingWithin, renderLapseReport, WARN_DAYS } from "../../scripts/check-lapses";

/**
 * The countdown to the annual roll.
 *
 * Six shards carry `staleAfterYears: 0` — the Pillar 4 group and free filing —
 * so they lapse the instant their year does, and `docs/annual-roll.md` names
 * them as the highest-harm figures here: "a COBRA election window that is wrong
 * is coverage that is simply gone."
 *
 * The lapse itself was already handled. `loadDataset` marks the dataset stale,
 * the tile shows its verify banner, and `staleness.test.ts` holds all of it —
 * the fail-safe works. What nothing covered was everything *before* it: the
 * roll is a manual runbook with no trigger, so the first signal that six
 * crisis-side tools had gone to banners would be a reader seeing one on January
 * 1st. This is the alarm clock, and these are the properties the alarm rests on.
 *
 * The date is an input, so every case here supplies one. A test that reads the
 * real clock would pass today and fail on a date nobody chose, which is the
 * hazard this whole file exists to move off `main` and onto a schedule.
 */
const MANIFEST = JSON.parse(
  readFileSync(resolve(__dirname, "..", "..", "data", "manifest.json"), "utf8"),
) as { datasets: { id: string; effectiveYear: number; staleAfterYears: number }[] };

const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

describe("when a bundled figure expires", () => {
  it("takes the lapse date from the rule the loader actually applies", () => {
    // `loadDataset` is stale when `asOfYear - effectiveYear > staleAfterYears`,
    // so the first stale year is effectiveYear + window + 1, from its first day.
    // Derived rather than written down, so a shard whose window changes moves
    // its own deadline.
    const zero = { id: "z", effectiveYear: 2026, staleAfterYears: 0 };
    expect(lapseFor(zero, day("2026-09-08")).lapsesOn).toBe("2027-01-01");
    expect(lapseFor(zero, day("2026-09-08")).daysLeft).toBe(115);
    // On the day itself: zero days left, and the day after, negative.
    expect(lapseFor(zero, day("2027-01-01")).daysLeft).toBe(0);
    expect(lapseFor(zero, day("2027-01-02")).daysLeft).toBe(-1);

    const twoYear = { id: "t", effectiveYear: 2026, staleAfterYears: 2 };
    expect(lapseFor(twoYear, day("2026-09-08")).lapsesOn).toBe("2029-01-01");
  });

  it("counts whole days, so a leap year is a day longer", () => {
    // A 2028 figure lapses on 2029-01-01. Counted from the first day of 2028 —
    // a leap year — that is 366 days, where the same span in 2027 is 365.
    expect(
      lapseFor({ id: "d", effectiveYear: 2028, staleAfterYears: 0 }, day("2028-01-01")).daysLeft,
    ).toBe(366);
    expect(
      lapseFor({ id: "d", effectiveYear: 2027, staleAfterYears: 0 }, day("2027-01-01")).daysLeft,
    ).toBe(365);
  });

  it("reports the soonest first, and only what falls inside the window", () => {
    const sets = [
      { id: "far", effectiveYear: 2026, staleAfterYears: 2 },
      { id: "soon", effectiveYear: 2026, staleAfterYears: 0 },
      { id: "gone", effectiveYear: 2024, staleAfterYears: 0 },
    ];
    const due = lapsingWithin(sets, day("2026-11-01"), 90);
    expect(due.map((l) => l.id)).toEqual(["gone", "soon"]);
    expect(lapsingWithin(sets, day("2026-01-01"), 90).map((l) => l.id)).toEqual(["gone"]);
  });

  it("says plainly when there is nothing to do", () => {
    const report = renderLapseReport([], 90);
    expect(report).toContain("Nothing to do");
    expect(report).not.toContain("annual-roll");
  });

  it("separates what has already lapsed from what is about to, and points at the runbook", () => {
    // A shard that has already lapsed is not a warning, it is a reader looking
    // at a verify banner right now — so the report must not bury it among the
    // countdowns.
    const sets = [
      { id: "gone", effectiveYear: 2024, staleAfterYears: 0 },
      { id: "soon", effectiveYear: 2026, staleAfterYears: 0 },
    ];
    const report = renderLapseReport(lapsingWithin(sets, day("2026-11-01"), 90), 90);
    expect(report).toContain("already lapsed");
    expect(report).toContain("showing a verify banner to readers");
    expect(report).toContain("`gone`");
    expect(report).toContain("`soon`");
    expect(report).toContain("docs/annual-roll.md");
    // The roll is a reading task; a report that reads like an edit invites a
    // copy-forward, which is the one thing the runbook says not to do.
    expect(report).toContain("never a summary of it");
  });

  it("is quiet about the real manifest today, and loud about it before the roll", () => {
    // Not a claim about a date: whatever today is, some day inside the window
    // before the earliest lapse must produce a report, or the alarm is decorative.
    const earliest = MANIFEST.datasets
      .map((d) => lapseFor(d, day("2000-01-01")))
      .sort((a, b) => a.daysLeft - b.daysLeft)[0]!;
    const justInside = new Date(day(earliest.lapsesOn).getTime() - (WARN_DAYS - 1) * 86_400_000);
    const justOutside = new Date(day(earliest.lapsesOn).getTime() - (WARN_DAYS + 1) * 86_400_000);
    expect(lapsingWithin(MANIFEST.datasets, justInside, WARN_DAYS).length).toBeGreaterThan(0);
    expect(lapsingWithin(MANIFEST.datasets, justOutside, WARN_DAYS)).toEqual([]);
  });

  it("warns far enough ahead to read six agency documents", () => {
    // The zero-window shards want their own sourcing pass rather than a
    // copy-forward, and that is the constraint the number encodes: 90 days puts
    // the first warning in early October, by which time the IRS has normally
    // published the next year's revenue procedure.
    expect(WARN_DAYS).toBeGreaterThanOrEqual(60);
  });
});
