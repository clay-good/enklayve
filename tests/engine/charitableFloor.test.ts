import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes, itemizedTotal } from "../../src/engine/tax";
import { Money } from "../../src/engine/money";
import { loadDatasets } from "../helpers/datasets";

/**
 * IRC §170(b)(1)(I): the floor an itemizer's giving must clear.
 *
 * The One Big Beautiful Bill Act rewrote charitable giving in two directions at
 * once, and this engine had modeled only the generous half. §170(p) lets a
 * non-itemizer deduct $1,000 without itemizing. §170(b)(1)(I), added by the same
 * Act's §70425 for taxable years after 2025, allows an itemizer's contributions
 * "only to the extent that the aggregate of such contributions exceeds 0.5
 * percent of the taxpayer's contribution base for the taxable year".
 *
 * So the same $1,000 of giving is now worth MORE to a filer who does not
 * itemize than the first $1,000 is to one who does. That is not an anomaly to
 * be smoothed over; it is what the two sections say, and the case below pins it.
 *
 * The engine had the deduction too LARGE, which is the direction that matters
 * differently: every other correction today gave a reader money back, and this
 * one takes some away. A tool that only ever finds errors in the taxpayer's
 * favour is not checking, it is flattering.
 */
describe("the 0.5% floor on an itemizer's giving", () => {
  let ds: Awaited<ReturnType<typeof loadDatasets>>;
  beforeAll(async () => {
    ds = await loadDatasets();
  });

  it("allows only what exceeds 0.5% of the contribution base", () => {
    // AGI 200,000 → the floor is 1,000. Giving 5,000 deducts 4,000.
    const total = itemizedTotal({ charitable: 5000 }, Money.from(200_000), Infinity, 0.005);
    expect(total.toNumber()).toBe(4000);
  });

  it("allows nothing at all when the giving is under the floor", () => {
    // A filer at 200,000 who gives 800 deducts none of it on Schedule A — and
    // is exactly the filer §170(p) was written for, if they take the standard
    // deduction instead.
    expect(
      itemizedTotal({ charitable: 800 }, Money.from(200_000), Infinity, 0.005).toNumber(),
    ).toBe(0);
  });

  it("is a floor and not a cap: everything above it still counts", () => {
    const at = (given: number): number =>
      itemizedTotal({ charitable: given }, Money.from(100_000), Infinity, 0.005).toNumber();
    expect(at(500)).toBe(0); // exactly the floor
    expect(at(501)).toBe(1); // a dollar over
    expect(at(50_000)).toBe(49_500);
  });

  it("does nothing for a tax year whose shard carries no floor", () => {
    // The rate defaults to zero, so every year before 2026 is unchanged.
    expect(itemizedTotal({ charitable: 5000 }, Money.from(200_000), Infinity).toNumber()).toBe(
      5000,
    );
  });

  it("never subtracts a floor from a negative income", () => {
    expect(
      itemizedTotal({ charitable: 5000 }, Money.from(-10_000), Infinity, 0.005).toNumber(),
    ).toBe(5000);
  });

  it("leaves §170(p) alone, because §170(p) says to", () => {
    // Not an inference. §170(p) computes its figure "determined without regard
    // to subsections (b)(1)(G)(ii), (b)(1)(I), and (d)(1)" — naming the floor.
    // A filer at 200,000 giving 1,000 deducts the full 1,000 without itemizing
    // and would deduct nothing of it on Schedule A.
    const ctx = { federal: ds.federal, fica: ds.fica };
    const base = {
      filingStatus: "single" as const,
      wages: 200_000,
      itemized: { charitable: 1000 },
    };
    const standard = evaluateTaxes({ ...base, deductionMode: "standard" }, ctx);
    expect(standard.federal.deduction.nonItemizedCharitable.toNumber()).toBe(1000);
    const itemizing = evaluateTaxes({ ...base, deductionMode: "itemized" }, ctx);
    expect(itemizing.federal.deduction.amount.toNumber()).toBe(0);
  });

  it("carries the rate on the federal shard, so the year owns it", () => {
    expect(ds.federal.charitableFloor?.rate).toBe(0.005);
  });

  it("moves the auto standard-versus-itemized choice, correctly", () => {
    // The floor makes itemizing worth less, so a filer near the line who used to
    // itemize may now do better on the standard deduction plus §170(p). The
    // comparison has to see the floor or it recommends the wrong package.
    const ctx = { federal: ds.federal, fica: ds.fica };
    const r = evaluateTaxes(
      {
        filingStatus: "single",
        wages: 120_000,
        // 16,000 of itemized deductions against a 16,100 standard deduction:
        // before the floor this itemized at 16,300, and now it does not.
        itemized: { stateAndLocalTaxes: 10_000, mortgageInterest: 5000, charitable: 1300 },
      },
      ctx,
    );
    expect(r.federal.deduction.kind).toBe("standard");
    // The standard side keeps §170(p) — worth the full 1,000 here, floor-free.
    expect(r.federal.deduction.nonItemizedCharitable.toNumber()).toBe(1000);
  });
});
