import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes, type TaxContext } from "../../src/engine/tax";
import type { FilingStatus } from "../../src/data/schemas";
import { loadDatasets, shippedStateCodes, type Datasets } from "../helpers/datasets";

/**
 * Bounds and fuzz tests (BUILD-SPEC.md §9): more income never decreases tax,
 * take-home is never negative, and the rates stay in [0, 1). Run over a large
 * seeded-random sample so the invariants are exercised broadly while staying
 * fully deterministic (no Math.random).
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

/** Deterministic LCG so the "fuzz" is reproducible run to run. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const STATUSES: FilingStatus[] = ["single", "married_jointly", "head_of_household"];

/**
 * Federal alone, and then every jurisdiction the bundle ships.
 *
 * This was thirteen hand-picked codes, and the comment beside them explained
 * that "ut" was on the list because it "is the one jurisdiction whose state tax
 * is not a plain bracket function of taxable income". That stopped being true
 * some time ago and nothing noticed: Arkansas and Connecticut ramp a high-income
 * recapture, Alabama and Oregon subtract the federal tax they compute
 * themselves, South Carolina, Wisconsin, Maine, Alabama and Connecticut slide a
 * standard deduction away as income rises, Maryland charges a county on top.
 * Every one of those is a shape that could bend a monotonic curve, and every one
 * of them arrived after the list was written.
 *
 * So the list is the bundle's now. These are the strongest claims the engine
 * makes — more income never lowers tax, take-home never falls, the marginal rate
 * stays under 100% — and they are the claims a household notices being wrong.
 * They should not hold for a quarter of the jurisdictions and be assumed for
 * the rest.
 */
const STATE_CODES: (string | null)[] = [null, ...shippedStateCodes()];

function contextFor(code: string | null): TaxContext {
  return code
    ? { federal: ds.federal, state: ds.state(code), fica: ds.fica }
    : { federal: ds.federal, fica: ds.fica };
}

describe("bounds invariants over a fuzzed sample", () => {
  it("holds across 1,000 random filers", () => {
    const rng = makeRng(0x5eed);
    for (let i = 0; i < 1000; i++) {
      const status = STATUSES[Math.floor(rng() * STATUSES.length)]!;
      const code = STATE_CODES[Math.floor(rng() * STATE_CODES.length)]!;
      const wages = Math.round(rng() * 2_000_000);
      const otherIncome = Math.round(rng() * 50_000);
      const localJurisdictionIds = code === "ny" && rng() > 0.5 ? ["nyc"] : undefined;

      const ctx = contextFor(code);
      const r = evaluateTaxes(
        { filingStatus: status, wages, otherIncome, localJurisdictionIds },
        ctx,
      );

      const label = `case ${i}: ${status} $${wages}+$${otherIncome} ${code ?? "federal"}`;

      // Every component is non-negative.
      expect(r.federal.incomeTax.isNegative(), label).toBe(false);
      expect(r.fica.total.isNegative(), label).toBe(false);
      if (r.state) expect(r.state.incomeTax.isNegative(), label).toBe(false);
      expect(r.local.total.isNegative(), label).toBe(false);
      expect(r.totals.totalTax.isNegative(), label).toBe(false);

      // Take-home is gross minus tax, never negative, never above gross.
      expect(r.totals.takeHome.isNegative(), label).toBe(false);
      expect(r.totals.takeHome.lessThanOrEqual(r.grossIncome), label).toBe(true);

      // Rates stay in [0, 1).
      expect(r.totals.marginalRate, label).toBeGreaterThanOrEqual(0);
      expect(r.totals.marginalRate, label).toBeLessThan(1);
      expect(r.totals.effectiveRate, label).toBeGreaterThanOrEqual(0);
      expect(r.totals.effectiveRate, label).toBeLessThan(1);
    }
  });
});

describe("monotonicity: more income never lowers tax", () => {
  it("total tax is non-decreasing in wages for every status and jurisdiction", () => {
    const rng = makeRng(0xc0ffee);
    for (let i = 0; i < 600; i++) {
      const status = STATUSES[Math.floor(rng() * STATUSES.length)]!;
      const code = STATE_CODES[Math.floor(rng() * STATE_CODES.length)]!;
      const ctx = contextFor(code);

      const base = Math.round(rng() * 1_000_000);
      const delta = 1 + Math.round(rng() * 100_000);

      const lower = evaluateTaxes({ filingStatus: status, wages: base }, ctx);
      const higher = evaluateTaxes({ filingStatus: status, wages: base + delta }, ctx);

      const label = `case ${i}: ${status} ${code ?? "federal"} ${base} -> ${base + delta}`;
      expect(higher.totals.totalTax.greaterThanOrEqual(lower.totals.totalTax), label).toBe(true);
      // And take-home still rises (combined marginal rate is below 100%).
      expect(higher.totals.takeHome.greaterThan(lower.totals.takeHome), label).toBe(true);
    }
  });
});

/**
 * The same two claims, deterministically, at every jurisdiction and at the
 * incomes where a schedule bends.
 *
 * The fuzz above draws a random state per case, so with fifty-two of them a
 * thousand cases give each about twenty — enough to find a broken shape, and
 * not enough to promise every state was asked. This asks all of them, at a
 * ladder that includes the places the exotic shapes turn: Arkansas's recapture
 * band edges ($94,700 and $97,900), Oregon's federal-subtraction phase-out
 * ($125,000 and $145,000), Alabama's sliding deduction floor ($35,500),
 * Massachusetts's surtax and Maine's, and the zero at the bottom that every
 * bracket table starts from.
 */
describe("every jurisdiction the bundle ships", () => {
  const LADDER = [
    0, 1, 5_000, 14_643, 25_000, 35_500, 47_500, 60_000, 94_700, 97_170, 97_900, 99_000, 125_000,
    145_000, 250_000, 500_000, 1_107_750, 1_200_000,
  ];

  it("has one, so an empty list cannot pass this silently", () => {
    expect(shippedStateCodes().length).toBeGreaterThan(50);
  });

  for (const status of STATUSES) {
    it(`holds the bounds and stays monotonic for a ${status.replace("_", " ")} filer`, () => {
      for (const code of shippedStateCodes()) {
        const ctx = contextFor(code);
        let previous: { wages: number; tax: number; takeHome: number } | null = null;
        for (const wages of LADDER) {
          const r = evaluateTaxes({ filingStatus: status, wages }, ctx);
          const label = `${code} ${status} $${wages}`;
          expect(r.state?.incomeTax.isNegative() ?? false, label).toBe(false);
          expect(r.totals.takeHome.isNegative(), label).toBe(false);
          expect(r.totals.marginalRate, label).toBeGreaterThanOrEqual(0);
          expect(r.totals.marginalRate, label).toBeLessThan(1);
          expect(r.totals.effectiveRate, label).toBeGreaterThanOrEqual(0);
          expect(r.totals.effectiveRate, label).toBeLessThan(1);
          const tax = r.totals.totalTax.toNumber();
          const takeHome = r.totals.takeHome.toNumber();
          if (previous) {
            const step = `${code} ${status} $${previous.wages} -> $${wages}`;
            expect(tax, `${step}: tax fell`).toBeGreaterThanOrEqual(previous.tax);
            expect(takeHome, `${step}: take-home fell`).toBeGreaterThan(previous.takeHome);
          }
          previous = { wages, tax, takeHome };
        }
      }
    });
  }
});
