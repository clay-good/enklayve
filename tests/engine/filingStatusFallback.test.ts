import { describe, it, expect, beforeAll } from "vitest";
import {
  bracketsFor,
  standardDeductionFor,
  personalExemptionFor,
} from "../../src/engine/tax/brackets";
import { evaluateTaxes } from "../../src/engine/tax";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Filing-status fallback (BUILD-SPEC.md §8). The seeded states define only
 * single / married-jointly / head-of-household, so the engine must resolve the
 * other two statuses sensibly:
 *   - qualifying surviving spouse uses the married-filing-jointly schedule
 *     (federally and in essentially every state) — it must NOT fall back to
 *     single, which would overstate the tax;
 *   - married-filing-separately falls back to single, the documented
 *     state-level assumption.
 * Federal defines all five statuses, so this only bites at the state layer.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

describe("state filing-status fallback", () => {
  it("resolves qualifying surviving spouse to the married-jointly schedule", () => {
    const ca = ds.state("ca");
    expect(ca.bracketsByFilingStatus.qualifying_surviving_spouse).toBeUndefined();
    expect(bracketsFor(ca, "qualifying_surviving_spouse")).toEqual(
      bracketsFor(ca, "married_jointly"),
    );
    expect(bracketsFor(ca, "qualifying_surviving_spouse")).not.toEqual(bracketsFor(ca, "single"));
    expect(standardDeductionFor(ca, "qualifying_surviving_spouse")).toBe(
      standardDeductionFor(ca, "married_jointly"),
    );
    expect(personalExemptionFor(ca, "qualifying_surviving_spouse")).toBe(
      personalExemptionFor(ca, "married_jointly"),
    );
  });

  it("still resolves married-filing-separately to single at the state level", () => {
    const ca = ds.state("ca");
    expect(bracketsFor(ca, "married_separately")).toEqual(bracketsFor(ca, "single"));
  });

  it("computes a surviving-spouse state tax equal to MFJ and below single", () => {
    const ctx = { federal: ds.federal, state: ds.state("ca"), fica: ds.fica };
    const wages = 150_000;
    const tax = (filingStatus: Parameters<typeof evaluateTaxes>[0]["filingStatus"]): number =>
      evaluateTaxes({ filingStatus, wages }, ctx).state!.incomeTax.toNumber();
    expect(tax("qualifying_surviving_spouse")).toBeCloseTo(tax("married_jointly"), 2);
    // The bug resolved QSS to single (narrower brackets) — that overstated it.
    expect(tax("qualifying_surviving_spouse")).toBeLessThan(tax("single"));
  });
});
