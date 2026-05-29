import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes, type TaxContext } from "../../src/engine/tax";
import type { FilingStatus } from "../../src/data/schemas";
import { loadDatasets, type Datasets } from "../helpers/datasets";

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
const STATE_CODES = [null, "ca", "ny", "tx", "fl", "pa", "il", "oh", "ga", "nc", "mi", "dc"];

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
