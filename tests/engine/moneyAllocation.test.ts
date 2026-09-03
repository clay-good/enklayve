import { describe, it, expect } from "vitest";
import { Money, allocateRounded } from "../../src/engine/money";

/**
 * Rounding each part on its own is correct part by part and wrong as a column.
 * On the Take-Home breakdown `sum(round(xᵢ))` disagreed with `round(sum(xᵢ))` in
 * about one case in fourteen — a reader adding federal, FICA, state and local
 * got a number the "Total tax" line beside it did not agree with, on a site
 * whose entire claim is that its arithmetic can be checked.
 */
const cents = (m: Money): number => m.toCents();

describe("allocating a rounded column so it adds up", () => {
  it("leaves an already-exact column alone", () => {
    const parts = [Money.from(10), Money.from(20.5)];
    expect(allocateRounded(parts, Money.from(30.5)).map(cents)).toEqual([1000, 2050]);
  });

  it("hands the missing cent to the part that gave up the most", () => {
    // 0.334 + 0.333 + 0.333 = 1.00 exactly. Rounded on their own: 0.33 each,
    // which sums to 0.99. The first part's remainder is the largest, so it
    // takes the cent back.
    const parts = [Money.from(0.334), Money.from(0.333), Money.from(0.333)];
    expect(allocateRounded(parts, Money.from(1)).map(cents)).toEqual([34, 33, 33]);
  });

  it("takes a cent back from the part that gained the most, not the smallest", () => {
    // 0.336 + 0.336 + 0.328 = 1.00. Rounded on their own: 0.34 + 0.34 + 0.33 =
    // 1.01, a cent too many. The cent comes off one of the 0.336s, which each
    // rounded UP by 0.4 of a cent, rather than off the 0.328, which rounded up
    // by only 0.2 — and that is the allocation with the smaller total displayed
    // error (1.2 cents against 1.6), which is the whole point of largest
    // remainder. Taking it off the smallest part instead is the intuitive
    // answer and the wrong one.
    const parts = [Money.from(0.336), Money.from(0.336), Money.from(0.328)];
    const out = allocateRounded(parts, Money.from(1)).map(cents);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
    expect(out).toEqual([33, 34, 33]);
  });

  it("always sums to the rounded total, over a spread of awkward splits", () => {
    for (let n = 2; n <= 6; n += 1) {
      for (let seed = 1; seed <= 200; seed += 1) {
        // Deterministic parts whose exact sum is a known total.
        const raw = Array.from({ length: n }, (_, i) => ((seed * (i + 7)) % 977) / 300);
        const parts = raw.map((v) => Money.from(v));
        const total = parts.reduce((a, b) => a.add(b), Money.zero());
        const out = allocateRounded(parts, total);
        expect(out.reduce((a, b) => a + b.toCents(), 0)).toBe(total.roundToCents().toCents());
        // And no part is moved by more than the cent it is allowed.
        for (const [i, m] of out.entries()) {
          expect(Math.abs(m.toCents() - parts[i]!.roundToCents().toCents())).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("returns an empty column unchanged", () => {
    expect(allocateRounded([], Money.zero())).toEqual([]);
  });
});
