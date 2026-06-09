import { describe, it, expect, beforeAll } from "vitest";
import { Money } from "../../src/engine/money";
import { estimateCapitalGains } from "../../src/engine/capitalGains";
import { compositeRate, projectIBond } from "../../src/engine/savingsBond";
import { estimateEitc, estimateCtc, fplPercent, povertyLine } from "../../src/engine/benefits";
import { debtPayoff } from "../../src/engine/finance";
import { requiredMinimumDistribution } from "../../src/engine/rmd";
import { adjustForInflation } from "../../src/engine/inflation";
import { selfEmploymentTax, itemizedTotal, evaluateTaxes } from "../../src/engine/tax";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import type { CapitalGainsData, FilingStatus } from "../../src/data/schemas";

/**
 * The robustness property suite (SPEC-3.md §2.9 + the §D coverage gaps in
 * SPEC-3-hardening.md). It complements the tax-engine bounds/monotonicity fuzz
 * in invariants.test.ts by sweeping the *other* public engine functions over the
 * boundary space — zero, negative, fractional, very large, and absent-key — and
 * asserting two things:
 *
 *   1. No public function throws on a boundary input (except where documented),
 *      and every Money it returns is finite (never NaN/Infinity), so a tile that
 *      formats it can never paint `$NaN`.
 *   2. The known statutory identities hold: SE tax on the 92.35% base, capital
 *      gains stacking on ordinary income, the EITC plateau, and the I-bond
 *      composite-rate formula.
 *
 * Fully deterministic: a seeded LCG drives the fuzz, so a failure reproduces.
 */

let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

/** Deterministic LCG (no Math.random, so the fuzz is reproducible). */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const isFinite = (m: Money): boolean => Number.isFinite(m.toNumber());

/** The boundary space every scalar input is drawn from. */
const BOUNDARY = [0, -1, -1e9, 1, 0.5, 1e-9, 12_345.67, 1e6, 1e9, 1e12, Number.MAX_SAFE_INTEGER];

const STATUSES: FilingStatus[] = [
  "single",
  "married_jointly",
  "married_separately",
  "head_of_household",
  "qualifying_surviving_spouse",
];

describe("§2.9 boundary sweep: no public function throws or returns a non-finite Money", () => {
  it("estimateCapitalGains over the boundary space, every filing status", () => {
    const federal = data.federal()!;
    const cg = data.capitalGains()!;
    for (const status of STATUSES) {
      for (const ord of BOUNDARY) {
        for (const lt of BOUNDARY) {
          const r = estimateCapitalGains(
            {
              filingStatus: status,
              ordinaryTaxableIncome: ord,
              shortTermGain: lt / 2,
              longTermGain: lt,
              modifiedAgi: ord + lt,
            },
            federal,
            cg,
          );
          const label = `${status} ord=${ord} lt=${lt}`;
          expect(isFinite(r.totalTax), label).toBe(true);
          expect(isFinite(r.longTermTax), label).toBe(true);
          expect(isFinite(r.netInvestmentIncomeTax), label).toBe(true);
          expect(r.totalTax.isNegative(), label).toBe(false);
          expect(Number.isFinite(r.effectiveRateOnGains), label).toBe(true);
        }
      }
    }
  });

  it("estimateEitc / estimateCtc / fplPercent over the boundary space", () => {
    const eitc = data.eitcCtc()!;
    const fpl = data.fpl("contiguous")!;
    for (const income of BOUNDARY) {
      for (const kids of [0, 1, 3, 7, -2]) {
        const e = estimateEitc(
          { earnedIncome: income, qualifyingChildren: kids, married: true },
          eitc,
        );
        const c = estimateCtc({ qualifyingChildren: kids, magi: income, married: false }, eitc);
        const label = `income=${income} kids=${kids}`;
        expect(isFinite(e.credit), label).toBe(true);
        expect(e.credit.isNegative(), label).toBe(false);
        expect(isFinite(c.credit) && isFinite(c.refundable), label).toBe(true);
        expect(c.refundable.greaterThan(c.credit), label).toBe(false); // refundable ≤ credit
        const p = fplPercent(income, Math.max(1, kids + 1), fpl);
        expect(Number.isFinite(p) && p >= 0, label).toBe(true);
        expect(isFinite(povertyLine(kids, fpl)), label).toBe(true); // size 0/-2 floors to 1
      }
    }
  });

  it("debtPayoff over the boundary space (a sub-interest payment returns null, not a hang)", () => {
    const rng = makeRng(0xbeef);
    for (let i = 0; i < 400; i++) {
      const balance = rng() * 200_000;
      const rate = rng() * 40; // 0–40% APR
      const payment = rng() * 5_000;
      const r = debtPayoff(balance, rate, payment);
      const label = `bal=${balance.toFixed(0)} rate=${rate.toFixed(1)} pay=${payment.toFixed(0)}`;
      // Either it never pays off (null) or it returns finite, non-negative figures.
      if (r !== null) {
        expect(isFinite(r.totalInterest) && isFinite(r.totalPaid), label).toBe(true);
        expect(r.months >= 0 && r.months <= 1200, label).toBe(true);
        expect(r.totalInterest.isNegative(), label).toBe(false);
      }
    }
  });

  it("requiredMinimumDistribution over the boundary space (no throw, finite amount)", () => {
    const rmd = data.rmd()!;
    for (const age of [0, 60, 72, 73, 90, 120, 130, 999]) {
      for (const bal of BOUNDARY) {
        const r = requiredMinimumDistribution(age, bal, rmd);
        expect(isFinite(r.amount), `age=${age} bal=${bal}`).toBe(true);
        expect(r.amount.isNegative(), `age=${age} bal=${bal}`).toBe(false);
      }
    }
  });

  it("selfEmploymentTax over the boundary space (no throw, finite, non-negative)", () => {
    const fica = data.fica()!;
    for (const status of STATUSES) {
      for (const profit of BOUNDARY) {
        const r = selfEmploymentTax(Money.from(profit), status, fica);
        const label = `${status} profit=${profit}`;
        expect(isFinite(r.total) && isFinite(r.taxableBase), label).toBe(true);
        expect(r.total.isNegative(), label).toBe(false);
      }
    }
  });

  // evaluateTaxes is the most-used public engine function and carries the whole
  // jurisdiction model — per-status brackets, the standard/itemized deduction,
  // personal exemptions and their phase-outs, the taxpayer credit, the
  // federal-tax deduction, the high-income recaptures, the percent-of-tax credit,
  // special-rule surtaxes, and local add-ons. Sweep it over EVERY seeded
  // jurisdiction × every filing status × a boundary space of income, and assert
  // the family invariants no tile may ever violate.
  it("evaluateTaxes over every jurisdiction × filing status: finite, non-negative, never above 100%", () => {
    const federal = data.federal()!;
    const fica = data.fica()!;
    const wagesGrid = [0, 1, 0.5, 12_345.67, 60_000, 95_000, 100_000, 300_000, 1e6, 1e9];
    const extras = [
      { otherIncome: 0, adjustments: 0 },
      { otherIncome: 50_000, adjustments: 0 },
      { otherIncome: 0, adjustments: 1e9 }, // drives AGI to its zero floor
    ];
    for (const code of data.stateCodes()) {
      const state = data.state(code) ?? undefined;
      for (const filingStatus of STATUSES) {
        for (const wages of wagesGrid) {
          for (const extra of extras) {
            const label = `${code} ${filingStatus} wages=${wages} ${JSON.stringify(extra)}`;
            const r = evaluateTaxes({ filingStatus, wages, ...extra }, { federal, state, fica });
            const { totals } = r;
            // Finiteness — a tile that formats any of these can never paint $NaN.
            expect(isFinite(r.state!.incomeTax), label).toBe(true);
            expect(isFinite(totals.totalTax) && isFinite(totals.takeHome), label).toBe(true);
            expect(isFinite(r.local.total), label).toBe(true);
            expect(Number.isFinite(totals.effectiveRate), label).toBe(true);
            expect(Number.isFinite(totals.marginalRate), label).toBe(true);
            // Tax is never negative; never more than 100% of gross (take-home ≥ 0).
            expect(r.state!.incomeTax.isNegative(), label).toBe(false);
            expect(totals.totalTax.isNegative(), label).toBe(false);
            expect(r.local.total.isNegative(), label).toBe(false);
            expect(totals.takeHome.toNumber(), label).toBeGreaterThanOrEqual(-0.01);
            // Rates stay in a sane band: effective in [0,1]; marginal in [0,1]
            // (no welfare cliff drives a $1 raise to cost more than $1 in tax).
            expect(totals.effectiveRate, label).toBeGreaterThanOrEqual(0);
            expect(totals.effectiveRate, label).toBeLessThanOrEqual(1);
            expect(totals.marginalRate, label).toBeGreaterThanOrEqual(-1e-9);
            expect(totals.marginalRate, label).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe("§2.9 statutory identities", () => {
  it("SE tax is computed on the 92.35% base, Social Security capped at the wage base", () => {
    const fica = data.fica()!;
    const rng = makeRng(0x5e1f);
    for (let i = 0; i < 200; i++) {
      const profit = rng() * 600_000;
      const r = selfEmploymentTax(Money.from(profit), "single", fica);
      // Net earnings from self-employment = 92.35% of profit.
      const base = Money.from(profit).multiply(0.9235);
      expect(r.taxableBase.roundToCents().toString()).toBe(base.roundToCents().toString());
      // SS portion = the combined SE rate (both halves, 2×6.2%) × min(base, wage base).
      const capped =
        base.toNumber() <= fica.socialSecurityWageBase
          ? base
          : Money.from(fica.socialSecurityWageBase);
      const expectedSs = capped.multiply(fica.socialSecurityRate * 2);
      expect(r.socialSecurity.roundToCents().toString()).toBe(expectedSs.roundToCents().toString());
    }
  });

  it("capital-gains long-term tax is non-decreasing as the ordinary income it stacks on rises", () => {
    const federal = data.federal()!;
    const cg = data.capitalGains()!;
    for (const status of STATUSES) {
      let prev = -1;
      for (const ord of [0, 20_000, 50_000, 100_000, 250_000, 600_000, 1_000_000]) {
        const r = estimateCapitalGains(
          {
            filingStatus: status,
            ordinaryTaxableIncome: ord,
            shortTermGain: 0,
            longTermGain: 80_000,
            modifiedAgi: ord + 80_000,
          },
          federal,
          cg,
        );
        const lt = r.longTermTax.toNumber();
        expect(lt, `${status} ord=${ord}`).toBeGreaterThanOrEqual(prev - 1e-6);
        prev = lt;
      }
    }
  });

  it("a long-term gain wholly inside the 0% bracket is taxed at $0", () => {
    const federal = data.federal()!;
    const cg = data.capitalGains()!;
    // Single: the 0% LT band runs up to its first nonzero lowerBound. A small gain
    // with no other income sits entirely inside it.
    const r = estimateCapitalGains(
      {
        filingStatus: "single",
        ordinaryTaxableIncome: 0,
        shortTermGain: 0,
        longTermGain: 1_000,
        modifiedAgi: 1_000,
      },
      federal,
      cg,
    );
    expect(r.longTermTax.isZero()).toBe(true);
    expect(r.longTermBands.every((b) => b.rate === 0)).toBe(true);
  });

  it("the EITC pays exactly maxCredit across the plateau, for every bracket", () => {
    const eitc = data.eitcCtc()!;
    for (const params of eitc.eitc) {
      const phaseInEnd = params.maxCredit / params.phaseInRate; // income where phase-in tops out
      const plateauEnd = params.phaseOutThresholdSingle; // phase-out begins here (single)
      if (plateauEnd <= phaseInEnd) continue; // no flat plateau for this bracket
      const mid = (phaseInEnd + plateauEnd) / 2;
      const r = estimateEitc(
        { earnedIncome: mid, qualifyingChildren: params.qualifyingChildren, married: false },
        eitc,
      );
      expect(r.credit.roundToCents().toString(), `qc=${params.qualifyingChildren}`).toBe(
        Money.from(params.maxCredit).roundToCents().toString(),
      );
    }
  });

  it("the I-bond composite rate follows the TreasuryDirect formula and floors at 0", () => {
    // TreasuryDirect worked example: 1.30% fixed + 1.69% semiannual inflation →
    // 0.013 + 2(0.0169) + 0.013(0.0169) = 0.0470197 ≈ 4.70%.
    expect(compositeRate(0.013, 0.0169)).toBeCloseTo(0.0470197, 9);
    // Deflation deep enough to drive the composite negative is floored at 0.
    expect(compositeRate(0.0, -0.05)).toBe(0);
    // Identity over a fuzz: composite = f + 2i + f·i when that is ≥ 0.
    const rng = makeRng(0x1b0d);
    for (let i = 0; i < 100; i++) {
      const f = rng() * 0.05;
      const inf = (rng() - 0.3) * 0.05;
      const formula = f + 2 * inf + f * inf;
      expect(compositeRate(f, inf)).toBeCloseTo(Math.max(0, formula), 12);
    }
  });
});

describe("§D coverage gaps (correct today, now pinned against future edits)", () => {
  it("capital-gains falls back to the single long-term schedule when a status table is absent", () => {
    const federal = data.federal()!;
    const cg = data.capitalGains()!;
    // Synthesize a dataset missing the qualifying_surviving_spouse LT brackets so
    // the documented `?? single` fallback (capitalGains.ts) actually fires.
    const noQss: CapitalGainsData = {
      ...cg,
      longTermBracketsByFilingStatus: { ...cg.longTermBracketsByFilingStatus },
      niitThresholdByFilingStatus: { ...cg.niitThresholdByFilingStatus },
    };
    delete (noQss.longTermBracketsByFilingStatus as Record<string, unknown>)[
      "qualifying_surviving_spouse"
    ];
    const input = {
      filingStatus: "qualifying_surviving_spouse" as FilingStatus,
      ordinaryTaxableIncome: 90_000,
      shortTermGain: 0,
      longTermGain: 120_000,
      modifiedAgi: 210_000,
    };
    const fellBack = estimateCapitalGains(input, federal, noQss);
    const asSingle = estimateCapitalGains({ ...input, filingStatus: "single" }, federal, noQss);
    // The LT split used the single schedule, so the LT tax matches the single run.
    expect(fellBack.longTermTax.roundToCents().toString()).toBe(
      asSingle.longTermTax.roundToCents().toString(),
    );
    expect(isFinite(fellBack.totalTax)).toBe(true);
  });

  it("RMD clamps an age past the table's max to the terminal distribution period", () => {
    const rmd = data.rmd()!;
    const atMax = requiredMinimumDistribution(120, 1_000_000, rmd);
    const beyond = requiredMinimumDistribution(130, 1_000_000, rmd);
    expect(beyond.required).toBe(true);
    expect(beyond.distributionPeriod).toBe(atMax.distributionPeriod);
    expect(beyond.amount.roundToCents().toString()).toBe(atMax.amount.roundToCents().toString());
  });

  it("projectIBond returns null for an unknown purchase period", () => {
    const bonds = data.treasuryBonds()!;
    expect(projectIBond(10_000, "1999-01", bonds)).toBeNull();
    // A known period still projects (the positive control).
    expect(projectIBond(10_000, bonds.rates[0]!.period, bonds)).not.toBeNull();
  });

  it("adjustForInflation returns null for a year absent from the CPI series", () => {
    const cpi = data.cpi()!;
    expect(adjustForInflation(100, 1800, 2025, cpi)).toBeNull();
    expect(adjustForInflation(100, 2024, 3000, cpi)).toBeNull();
    expect(adjustForInflation(100, 2024, 2025, cpi)).not.toBeNull();
  });

  it("debtPayoff returns null when the payment exactly equals the first month's interest", () => {
    // 1% per month on $10,000 = $100 interest in month one. A $100 payment never
    // touches principal — the equality boundary of the payment ≤ interest guard.
    expect(debtPayoff(10_000, 12, 100)).toBeNull();
    // One cent more does retire it (the positive control either side of the edge).
    expect(debtPayoff(10_000, 12, 100.01)).not.toBeNull();
  });

  it("itemizedTotal never lets the medical deduction exceed actual expenses at negative AGI", () => {
    // A large above-the-line adjustment can push AGI negative; the 7.5% floor must
    // not turn into a negative number that *inflates* the deduction.
    const withNegAgi = itemizedTotal({ medicalExpenses: 5_000 }, Money.from(-40_000));
    const withZeroAgi = itemizedTotal({ medicalExpenses: 5_000 }, Money.zero());
    expect(withNegAgi.toNumber()).toBe(5_000); // whole expense, no more
    expect(withZeroAgi.toNumber()).toBe(5_000);
  });
});
