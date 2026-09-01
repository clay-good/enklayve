import { describe, it, expect, beforeAll } from "vitest";
import {
  evaluateTaxes,
  chooseFederalDeduction,
  nonItemizerCharitableFor,
} from "../../src/engine/tax";
import { Money } from "../../src/engine/money";
import type { NonItemizerCharitableData } from "../../src/data/schemas";
import { loadDatasets } from "../helpers/datasets";

/**
 * IRC §170(p): cash giving deducted without itemizing.
 *
 * Added by the One Big Beautiful Bill Act (Pub. L. 119-21 §70424) for taxable
 * years beginning after December 31, 2025 — so it applies to the year this site
 * is seeded on, and it was on the deferred list until 2026-09-01. It came off
 * because it is the one of the Act's four new deductions that needs no input
 * the tiles do not already collect: the federal-tax and take-home tiles have
 * asked for charitable giving since launch, as one of the itemized "big four".
 *
 * Mechanically it is not part of the standard deduction. §63(b)(4) lists it as
 * a separate subtraction from adjusted gross income for a filer who does not
 * itemize, which is why it is reported separately rather than folded in.
 */
const RULE: NonItemizerCharitableData = { cap: 1000, capJointReturn: 2000 };

describe("what §170(p) allows", () => {
  it("gives the whole gift when it is under the cap", () => {
    expect(nonItemizerCharitableFor(RULE, "single", { charitable: 400 }).toNumber()).toBe(400);
  });

  it("gives the whole gift AT the cap", () => {
    // The statute says "not in excess of $1,000", so a filer who gave exactly
    // $1,000 deducts all of it.
    expect(nonItemizerCharitableFor(RULE, "single", { charitable: 1000 }).toNumber()).toBe(1000);
  });

  it("stops at the cap above it", () => {
    expect(nonItemizerCharitableFor(RULE, "single", { charitable: 50_000 }).toNumber()).toBe(1000);
  });

  it("doubles the cap on a joint return, and only there", () => {
    // "$2,000 in the case of a joint return" — the statute's own words. A
    // qualifying surviving spouse files at joint RATES and does not file a
    // joint return, so the single cap is the reading the words support.
    expect(nonItemizerCharitableFor(RULE, "married_jointly", { charitable: 5000 }).toNumber()).toBe(
      2000,
    );
    expect(
      nonItemizerCharitableFor(RULE, "qualifying_surviving_spouse", {
        charitable: 5000,
      }).toNumber(),
    ).toBe(1000);
    expect(
      nonItemizerCharitableFor(RULE, "married_separately", { charitable: 5000 }).toNumber(),
    ).toBe(1000);
    expect(
      nonItemizerCharitableFor(RULE, "head_of_household", { charitable: 5000 }).toNumber(),
    ).toBe(1000);
  });

  it("is nothing at all for a year with no such rule", () => {
    // Absence means something here: before 2026 there was no §170(p), and zero
    // is the right answer rather than a missing one.
    expect(nonItemizerCharitableFor(undefined, "single", { charitable: 5000 }).toNumber()).toBe(0);
  });

  it("is nothing when nothing was given", () => {
    expect(nonItemizerCharitableFor(RULE, "single", {}).toNumber()).toBe(0);
  });
});

describe("choosing between standard and itemized once §170(p) exists", () => {
  const standard = Money.from(32_200);
  const chose = (itemizedAmounts: Record<string, number>, charity: Money) =>
    chooseFederalDeduction(
      "auto",
      standard,
      itemizedAmounts,
      Money.from(300_000),
      Infinity,
      charity,
    );

  it("counts the giving on the standard side of the comparison", () => {
    // $31,000 itemized against $32,200 standard: standard wins either way.
    expect(chose({ charitable: 2000, mortgageInterest: 29_000 }, Money.from(2000)).kind).toBe(
      "standard",
    );
  });

  it("keeps the standard deduction when itemizing would forfeit more than it gains", () => {
    // $33,000 itemized beats the bare $32,200 standard — but not the $34,200
    // package of standard plus §170(p). A comparison that left the giving out
    // of the sum it was choosing between would itemize and cost this filer
    // $1,200 of deduction.
    const r = chose({ charitable: 2000, mortgageInterest: 31_000 }, Money.from(2000));
    expect(r.kind).toBe("standard");
    expect(r.nonItemizedCharitable.toNumber()).toBe(2000);
  });

  it("still itemizes when itemizing genuinely wins", () => {
    const r = chose({ charitable: 2000, mortgageInterest: 40_000 }, Money.from(2000));
    expect(r.kind).toBe("itemized");
    // Itemizing forfeits §170(p) — the statute gives it only to a filer who
    // does not elect to itemize.
    expect(r.nonItemizedCharitable.toNumber()).toBe(0);
  });
});

describe("through the whole engine", () => {
  let ds: Awaited<ReturnType<typeof loadDatasets>>;
  beforeAll(async () => {
    ds = await loadDatasets();
  });

  it("is on the federal shard with the statute's caps", () => {
    expect(ds.federal.nonItemizerCharitable).toEqual(RULE);
  });

  it("lowers the tax of a standard-deduction filer who gave", () => {
    const input = { filingStatus: "single" as const, wages: 80_000 };
    const without = evaluateTaxes(input, { federal: ds.federal, fica: ds.fica });
    const with170p = evaluateTaxes(
      { ...input, itemized: { charitable: 1500 } },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(with170p.federal.deduction.kind).toBe("standard");
    expect(with170p.federal.deduction.nonItemizedCharitable.toNumber()).toBe(1000);
    expect(with170p.federal.taxableIncome.toNumber()).toBe(
      without.federal.taxableIncome.toNumber() - 1000,
    );
    expect(with170p.federal.incomeTax.lessThan(without.federal.incomeTax)).toBe(true);
  });

  it("does not leak into the deduction figure Utah's credit is a share of", () => {
    // Utah Code §59-10-1018 credits a percentage of "the federal deduction".
    // Whether Utah conforms to §170(p) is a question for Utah, and widening
    // this number would answer it silently.
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 80_000, itemized: { charitable: 1500 } },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(r.federal.deduction.amount.toNumber()).toBe(
      ds.federal.standardDeductionByFilingStatus.single,
    );
  });
});
