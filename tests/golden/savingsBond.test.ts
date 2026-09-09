import { describe, it, expect, beforeAll } from "vitest";
import {
  MIN_HOLD_PERIODS,
  compositeRate,
  projectIBond,
  ratePeriods,
} from "../../src/engine/savingsBond";
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
  it("values a $10,000 May-2022 bond through May 2026", () => {
    // Fixed 0% (locked May 2022), so each composite = 2·semi. Compounding the nine
    // semiannual periods from May 2022 through May 2026 (rounding each to cents).
    const r = projectIBond(10000, "2022-05", ds.treasuryBonds)!;
    expect(r).not.toBeNull();
    expect(r.fixedRate).toBe(0);
    expect(r.periodsHeld).toBe(9);
    expect(r.currentValue.roundToCents().toNumber()).toBe(12038.44);
    expect(r.interestEarned.roundToCents().toNumber()).toBe(2038.44);
    // The first period earns the at-purchase composite (9.62%).
    expect(r.periods[0]!.compositeRate).toBeCloseTo(0.0962, 6);
  });

  it("locks the fixed rate at purchase, not the latest period", () => {
    // A Nov-2023 bond has fixed 1.30%; the latest composite uses that fixed rate.
    const r = projectIBond(10000, "2023-11", ds.treasuryBonds)!;
    expect(r.fixedRate).toBe(0.013);
    // Latest period May 2026 semi 1.67% with fixed 1.30% -> 4.66%.
    expect(r.latestCompositeRate).toBeCloseTo(0.0466171, 6);
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

  it("cannot be cashed in the first 12 months", () => {
    const rates = ds.treasuryBonds.rates;
    const newest = projectIBond(10000, rates[rates.length - 1]!.period, ds.treasuryBonds)!;
    expect(newest.periodsHeld).toBe(1);
    expect(newest.redeemable).toBe(false);
    // Nothing is forfeited on a redemption that cannot happen.
    expect(newest.earlyRedemptionPenalty.isZero()).toBe(true);
    expect(newest.redemptionValue.toNumber()).toBe(newest.currentValue.toNumber());
  });

  it("becomes redeemable at exactly twelve months, not a period later", () => {
    // `npm run check:boundaries` flags a comparison no test sits on, and this
    // one — `periods.length >= MIN_HOLD_PERIODS` — arrived today with a case at
    // one period and a case at three. `>=` against `>` is the difference
    // between a bond you can cash on its first anniversary and one you cannot,
    // so the boundary is the case.
    const rates = ds.treasuryBonds.rates;
    const justOneShort = projectIBond(10000, rates[rates.length - 1]!.period, ds.treasuryBonds)!;
    const exactlyTwelve = projectIBond(10000, rates[rates.length - 2]!.period, ds.treasuryBonds)!;
    expect(justOneShort.periodsHeld).toBe(1);
    expect(exactlyTwelve.periodsHeld).toBe(MIN_HOLD_PERIODS);
    expect(justOneShort.redeemable).toBe(false);
    expect(exactlyTwelve.redeemable).toBe(true);
    // And the penalty starts applying the moment redemption does.
    expect(justOneShort.earlyRedemptionPenalty.isZero()).toBe(true);
    expect(exactlyTwelve.earlyRedemptionPenalty.isZero()).toBe(false);
  });

  it("forfeits the last three months of interest before five years", () => {
    const rates = ds.treasuryBonds.rates;
    const r = projectIBond(10000, rates[rates.length - 3]!.period, ds.treasuryBonds)!;
    expect(r.periodsHeld).toBe(3);
    expect(r.redeemable).toBe(true);
    // Three months is half of the most recent six-month period's accrual.
    const lastInterest = r.periods[r.periods.length - 1]!.interest;
    expect(r.earlyRedemptionPenalty.toNumber()).toBe(
      Math.round((lastInterest.toNumber() / 2) * 100) / 100,
    );
    expect(r.redemptionValue.toNumber()).toBeCloseTo(
      r.currentValue.toNumber() - r.earlyRedemptionPenalty.toNumber(),
      2,
    );
    // The penalty never eats into what you paid.
    expect(r.redemptionValue.toNumber()).toBeGreaterThanOrEqual(r.purchaseAmount.toNumber());
  });

  it("never charges a penalty on a bond held five years", () => {
    const rates = ds.treasuryBonds.rates;
    if (rates.length < 10) return;
    const r = projectIBond(10000, rates[rates.length - 10]!.period, ds.treasuryBonds)!;
    expect(r.periodsHeld).toBeGreaterThanOrEqual(10);
    expect(r.earlyRedemptionPenalty.isZero()).toBe(true);
    expect(r.redemptionValue.toNumber()).toBe(r.currentValue.toNumber());
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
