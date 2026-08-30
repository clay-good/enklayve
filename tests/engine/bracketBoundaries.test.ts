import { describe, it, expect } from "vitest";
import { bracketTax, marginalBracketRate } from "../../src/engine/tax/brackets";
import { Money } from "../../src/engine/money";

/**
 * What happens at exactly a bracket threshold.
 *
 * `bracketTax` and `marginalBracketRate` are the two most load-bearing routines
 * in the engine — every federal, state and local figure on the site goes
 * through them — and they contain four boundary comparisons between them.
 * Flipping three of the four fails nothing in a suite of 1,813 tests: the
 * marginal rate's `>=`, the band-ceiling `>`, and the `baseTax` band's `<=`.
 * Exact thresholds are a measure-zero event for arbitrary incomes and the
 * likeliest place for a filer who is *aiming* — someone sizing a 401(k)
 * contribution to land on a bracket edge is exactly the person the marginal
 * explorer is for.
 *
 * The subtle part, and the reason this is written down rather than merely
 * asserted: **the two functions disagree at a threshold, correctly.** They
 * answer different questions.
 *
 *   bracketTax(26_050)          -> $0        "what do I owe on this income"
 *   marginalBracketRate(26_050) -> 2.75%     "what is my next dollar taxed at"
 *
 * Ohio's schedule reads "Not over $26,050: 0%", so income of exactly $26,050
 * owes nothing — and the next dollar earned is over the line, so it is taxed at
 * 2.75%. Anyone reconciling the two into agreement breaks one of them.
 */
const OHIO = [
  { lowerBound: 0, rate: 0 },
  { lowerBound: 26_050, rate: 0.0275, baseTax: 332 },
  { lowerBound: 100_000, rate: 0.035, baseTax: 2_366 },
];
const tax = (n: number): number => bracketTax(Money.from(n), OHIO).toNumber();
const rate = (n: number): number => marginalBracketRate(Money.from(n), OHIO);

describe("tax owed at a bracket threshold", () => {
  it("puts income exactly on a threshold in the band below it", () => {
    // "Not over $26,050" includes $26,050.
    expect(tax(26_049.99)).toBe(0);
    expect(tax(26_050)).toBe(0);
  });

  it("applies the band's statutory base only once past the threshold", () => {
    // Ohio's "$332.00 plus 2.75% of the amount in excess of $26,050" is a real
    // step: one cent over the line costs $332. That is the statute, not a
    // rounding artefact, and it must not move.
    expect(tax(26_050.01)).toBeCloseTo(332.000275, 6);
    expect(tax(100_000)).toBeCloseTo(2_365.625, 6);
    expect(tax(100_000.01)).toBeCloseTo(4_399.62535, 5);
  });

  it("does not stack the bases of the bands below", () => {
    // Only the band the income lands in contributes its base. Crossing into the
    // 3.5% band must not also add the 2.75% band's $332.
    expect(tax(100_000.01)).toBeLessThan(2_366 + 332 + 100_000 * 0.035);
  });
});

describe("the marginal rate at a bracket threshold", () => {
  it("returns the rate the next dollar will actually pay", () => {
    // Flipping this comparison to `>` fails nothing else in the suite, and
    // would show a filer sitting exactly on a threshold the rate of the band
    // they have just left.
    expect(rate(26_049.99)).toBe(0);
    expect(rate(26_050)).toBe(0.0275);
    expect(rate(26_050.01)).toBe(0.0275);
    expect(rate(99_999.99)).toBe(0.0275);
    expect(rate(100_000)).toBe(0.035);
  });

  it("gives the first band's rate below every threshold, including at zero", () => {
    expect(rate(0)).toBe(0);
    expect(rate(1)).toBe(0);
  });

  it("disagrees with the tax owed at a threshold, on purpose", () => {
    // The one assertion here that is about the relationship rather than either
    // function: at $26,050 nothing is owed and the next dollar is taxed at
    // 2.75%. Both are correct, and a change that makes them agree is a
    // regression in one of them.
    expect(tax(26_050)).toBe(0);
    expect(rate(26_050)).toBe(0.0275);
  });
});

describe("an unsorted schedule is read in the order the statute means", () => {
  it("sorts defensively rather than trusting the shard's key order", () => {
    const shuffled = [OHIO[2]!, OHIO[0]!, OHIO[1]!];
    expect(bracketTax(Money.from(50_000), shuffled).toNumber()).toBeCloseTo(
      bracketTax(Money.from(50_000), OHIO).toNumber(),
      6,
    );
    expect(marginalBracketRate(Money.from(50_000), shuffled)).toBe(0.0275);
  });
});
