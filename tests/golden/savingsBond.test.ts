import { describe, it, expect, beforeAll } from "vitest";
import { compositeRate, projectIBond, ratePeriods } from "../../src/engine/savingsBond";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Series I savings-bond math (BUILD-SPEC.md §3.4, §9). The composite-rate cases
 * are the exact TreasuryDirect-published figures, so a wrong formula fails here.
 * The projection is computed straight from the bundled rate history.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

describe("I-bond composite rate", () => {
  it("matches published composite rates to the basis point", () => {
    // composite = fixed + 2·semi + fixed·semi (annualized), floored at 0.
    // May 2022: fixed 0.00%, semi 4.81% -> 9.62%.
    expect(compositeRate(0.0, 0.0481)).toBeCloseTo(0.0962, 6);
    // Nov 2022: fixed 0.40%, semi 3.24% -> 6.89%.
    expect(compositeRate(0.004, 0.0324)).toBeCloseTo(0.06893, 5);
    // May 2024: fixed 1.30%, semi 1.48% -> 4.28%.
    expect(compositeRate(0.013, 0.0148)).toBeCloseTo(0.0427924, 6);
  });

  it("floors a deflationary composite at zero (never negative)", () => {
    // A semiannual inflation rate of -2% with a 0% fixed rate would be -4%.
    expect(compositeRate(0.0, -0.02)).toBe(0);
  });
});

describe("I-bond projection", () => {
  it("values a $10,000 May-2022 bond through May 2024", () => {
    // Fixed 0% (locked May 2022), so each composite = 2·semi.
    // 10000 ×1.0481 =10481.00 ×1.0324 =10820.58 ×1.0169 =11003.45
    //               ×1.0197 =11220.22 ×1.0148 =11386.28, rounding each period.
    const r = projectIBond(10000, "2022-05", ds.treasuryBonds)!;
    expect(r).not.toBeNull();
    expect(r.fixedRate).toBe(0);
    expect(r.periodsHeld).toBe(5);
    expect(r.currentValue.roundToCents().toNumber()).toBe(11386.28);
    expect(r.interestEarned.roundToCents().toNumber()).toBe(1386.28);
    // The first period earns the at-purchase composite (9.62%).
    expect(r.periods[0]!.compositeRate).toBeCloseTo(0.0962, 6);
  });

  it("locks the fixed rate at purchase, not the latest period", () => {
    // A Nov-2023 bond has fixed 1.30%; the latest composite uses that fixed rate.
    const r = projectIBond(10000, "2023-11", ds.treasuryBonds)!;
    expect(r.fixedRate).toBe(0.013);
    // Latest period May 2024 semi 1.48% with fixed 1.30% -> 4.28%.
    expect(r.latestCompositeRate).toBeCloseTo(0.0427924, 6);
  });

  it("never decreases in value across periods (monotonic)", () => {
    const r = projectIBond(5000, "2021-11", ds.treasuryBonds)!;
    for (const p of r.periods) {
      expect(p.endValue.toNumber()).toBeGreaterThanOrEqual(p.startValue.toNumber());
      expect(p.interest.toNumber()).toBeGreaterThanOrEqual(0);
    }
    expect(r.currentValue.toNumber()).toBeGreaterThanOrEqual(5000);
  });

  it("returns a single period for a bond bought in the latest period", () => {
    const periods = ratePeriods(ds.treasuryBonds).map((p) => p.period);
    const latest = periods[periods.length - 1]!;
    const r = projectIBond(1000, latest, ds.treasuryBonds)!;
    expect(r.periodsHeld).toBe(1);
  });

  it("returns null for an unknown purchase period (never guesses)", () => {
    expect(projectIBond(1000, "1999-05", ds.treasuryBonds)).toBeNull();
  });

  it("is deterministic for the same inputs", () => {
    const a = projectIBond(10000, "2022-05", ds.treasuryBonds)!;
    const b = projectIBond(10000, "2022-05", ds.treasuryBonds)!;
    expect(a.currentValue.toNumber()).toBe(b.currentValue.toNumber());
  });
});
