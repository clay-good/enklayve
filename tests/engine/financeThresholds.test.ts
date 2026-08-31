import { describe, it, expect, beforeAll } from "vitest";
import {
  balanceTransferBreakEven,
  cashFlowTimeline,
  coastFireProjection,
  debtPayoff,
  loanPrincipalFromPayment,
  monthlyMortgagePayment,
  retirementDrawdown,
} from "../../src/engine/finance";
import { loadBundledData, type BundledData } from "../../src/data/browser";

/**
 * The exact inputs at which a finance answer flips.
 *
 * These comparisons have nothing to do with a statute — they are the engine
 * deciding whether a loop runs one more time, whether a debt is payable at all,
 * whether a goal is reached. Each was on the unheld list, and each has an exact
 * input at which the two readings give a household different answers about
 * their own money.
 *
 * Two of them are the same shape and are the most consequential in the file: a
 * payment that exactly equals the monthly interest never retires the debt, and
 * the engine's contract is to say so rather than show infinity. Read `<`
 * instead of `<=` and the balance stops falling while the loop keeps counting,
 * so the answer becomes a payoff date hundreds of months out — a confident,
 * specific, and completely false date, which is worse than the honest null.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

describe("a payment that exactly covers the interest and nothing more", () => {
  it("reports that the debt never retires, rather than a date", () => {
    // $10,000 at 12% APR accrues exactly $100 in the first month.
    expect(debtPayoff(10_000, 12, 100)).toBeNull();
  });

  it("retires it on the very next cent", () => {
    const r = debtPayoff(10_000, 12, 100.01);
    expect(r).not.toBeNull();
    expect(r!.months).toBeGreaterThan(0);
  });

  it("says the same on the balance-transfer path", () => {
    // The transferred balance carries its own copy of the rule, inside the
    // phased simulation. $10,000 at a 12% intro APR against a $100 payment.
    const r = balanceTransferBreakEven({
      balance: 10_000,
      currentAprPct: 24,
      monthlyPayment: 100,
      transferFeePct: 0,
      introAprPct: 12,
      introMonths: 18,
      postIntroAprPct: 24,
    });
    expect(r.transferMonths).toBeNull();
    expect(r.transferTotalCost).toBeNull();
    expect(r.paysOffWithinIntro).toBe(false);
  });
});

describe("clearing a transferred balance in exactly the intro window", () => {
  it("counts the final intro month as inside the window", () => {
    // $1,200 at 0% intro, $100 a month: cleared in exactly 12 months, the last
    // month of a 12-month promotion. "Before the intro rate ends" includes the
    // month it ends in — that is the whole question the tool answers, and
    // flipped it tells someone who makes it with nothing to spare that they
    // did not.
    const r = balanceTransferBreakEven({
      balance: 1_200,
      currentAprPct: 24,
      monthlyPayment: 100,
      transferFeePct: 0,
      introAprPct: 0,
      introMonths: 12,
      postIntroAprPct: 24,
    });
    expect(r.transferMonths).toBe(12);
    expect(r.paysOffWithinIntro).toBe(true);
  });

  it("does not count a month past the window", () => {
    const r = balanceTransferBreakEven({
      balance: 1_200,
      currentAprPct: 24,
      monthlyPayment: 100,
      transferFeePct: 0,
      introAprPct: 0,
      introMonths: 11,
      postIntroAprPct: 24,
    });
    expect(r.paysOffWithinIntro).toBe(false);
  });
});

describe("a loan with a term of exactly zero years", () => {
  it("returns zero rather than dividing by it", () => {
    // `n <= 0` is the guard, and it is the only thing between this and a
    // division by zero: flipped, the zero-rate path computes `principal / 0`
    // and the amortization path raises `(1+r)` to the power of nothing. The
    // no-NaN promise is held here, one comparison deep.
    const payment = monthlyMortgagePayment(300_000, 6, 0);
    expect(payment.toNumber()).toBe(0);
    expect(Number.isFinite(payment.toNumber())).toBe(true);
    const principal = loanPrincipalFromPayment(2_000, 6, 0);
    expect(principal.toNumber()).toBe(0);
    expect(Number.isFinite(principal.toNumber())).toBe(true);
  });

  it("still amortizes a one-month term", () => {
    const payment = monthlyMortgagePayment(1_200, 0, 1 / 12);
    expect(payment.toNumber()).toBeCloseTo(1_200, 6);
  });
});

describe("the last day of the month in a cash-flow timeline", () => {
  it("applies a bill dated the 31st", () => {
    // Rent on the 1st, pay on the 15th, a big autopay on the 31st. `d <= 31` is
    // what makes the 31st exist: flipped, the day is dropped silently — no
    // error, no warning, just a month that ends $900 richer than it will.
    const r = cashFlowTimeline(2_000, [
      { day: 1, amount: -1_400, label: "Rent" },
      { day: 15, amount: 1_800, label: "Pay" },
      { day: 31, amount: -900, label: "Card autopay" },
    ]);
    expect(r.days.map((d) => d.day)).toEqual([1, 15, 31]);
    expect(r.endingBalance.toNumber()).toBe(1_500);
    expect(r.minDay).toBe(1);
    expect(r.minBalance.toNumber()).toBe(600);
  });

  it("catches a month that only goes negative on the 31st", () => {
    const r = cashFlowTimeline(500, [{ day: 31, amount: -600 }]);
    expect(r.goesNegative).toBe(true);
    expect(r.minDay).toBe(31);
  });
});

describe("a balance that has exactly reached its coast number", () => {
  it("counts landing exactly on the target as reached", () => {
    // A 0% real return makes the projection the balance itself, so "exactly on
    // the number" is expressible without floating-point luck. The Downshift
    // Point is the moment saving becomes optional; flipped, someone standing on
    // it is told they have not arrived, with a gap of $0 to close.
    const r = coastFireProjection({
      currentBalance: 900_000,
      annualRealReturnPct: 0,
      years: 20,
      targetNumber: 900_000,
    });
    expect(r.projected.toNumber()).toBe(900_000);
    expect(r.reached).toBe(true);
    expect(r.gap.toNumber()).toBe(0);
  });

  it("is not reached a dollar short", () => {
    const r = coastFireProjection({
      currentBalance: 899_999,
      annualRealReturnPct: 0,
      years: 20,
      targetNumber: 900_000,
    });
    expect(r.reached).toBe(false);
    expect(r.gap.toNumber()).toBe(1);
  });
});

describe("the final year of a retirement drawdown", () => {
  it("projects through the last age, not up to it", () => {
    // `age <= maxAge` decides whether the projection includes the age the user
    // asked about. Flipped, the timeline stops a year early and "lasts to 90"
    // is answered from a projection that never reached 90.
    const r = retirementDrawdown(
      {
        currentBalance: 1_000_000,
        currentAge: 65,
        annualWithdrawal: 30_000,
        realReturnPct: 3,
        maxAge: 70,
      },
      data.rmd(),
    );
    expect(r.timeline.map((y) => y.age)).toEqual([65, 66, 67, 68, 69, 70]);
    expect(r.lastsToMaxAge).toBe(true);
    // Six rows, five years of span: `yearsLasting` is `maxAge - startAge` when
    // nothing depletes, and the row for age 70 is the sixth.
    expect(r.yearsLasting).toBe(5);
  });

  it("stops early when the money runs out", () => {
    const r = retirementDrawdown(
      {
        currentBalance: 50_000,
        currentAge: 65,
        annualWithdrawal: 30_000,
        realReturnPct: 0,
        maxAge: 90,
      },
      data.rmd(),
    );
    expect(r.lastsToMaxAge).toBe(false);
    expect(r.depletedAtAge).not.toBeNull();
  });
});
