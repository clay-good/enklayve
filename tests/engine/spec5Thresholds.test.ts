import { describe, it, expect, beforeAll } from "vitest";
import { compareDependentCare } from "../../src/engine/dependentCare";
import { earlyDistributionCost } from "../../src/engine/earlyDistribution";
import { medicareSavingsScreen } from "../../src/engine/medicareSavings";
import { pmiEndDates } from "../../src/engine/pmi";
import { survivorFraMonths } from "../../src/engine/ssFamily";
import { interestDeduction } from "../../src/engine/studentLoans";
import { ssiEstimate } from "../../src/engine/ssi";
import { Money } from "../../src/engine/money";
import { loadBundledData, type BundledData } from "../../src/data/browser";

/**
 * SPEC-5's thresholds, each on the exact value the rule names (SPEC-5
 * hardening, 2026-10-20). The boundary check counts only tests in
 * tests/engine and tests/golden as holding a comparison, and SPEC-5's cases
 * lived beside its tiles, so every threshold it added read as unheld. These
 * sit exactly on each line, where `<=` and `<` give different answers.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
  await Promise.all(
    [
      "medicare-savings-2026",
      "dependent-care-2026",
      "early-distribution-2026",
      "ss-family-benefits-2026",
      "student-loans-2026",
      "ssi-2026",
    ].map((id) => data.loadDeferred(id)),
  );
});

describe("SPEC-5 thresholds, on the line", () => {
  it("Medicare Savings and Extra Help: at each federal line is under it", () => {
    const rules = data.medicareSavings()!;
    const at = (monthlyIncome: number, resources: number) =>
      medicareSavingsScreen({ couple: false, monthlyIncome, resources }, rules);
    expect(at(1350, 0).programs[0]!.underIncomeLine).toBe(true); // QMB, exactly $1,350
    expect(at(0, 9950).underSavingsResourceLimit).toBe(true);
    expect(at(1995, 0).extraHelp.underIncomeLine).toBe(true); // $23,940 a year
    expect(at(0, 16590).extraHelp.resources).toBe("under");
    expect(at(0, 18090).extraHelp.resources).toBe("under-with-burial");
  });

  it("dependent care: two qualifying individuals take the $6,000 cap", () => {
    const r = compareDependentCare(
      {
        filingStatus: "single",
        wages: 200000,
        lowerEarnerWages: 0,
        spouseDeemedEarner: false,
        qualifyingIndividuals: 2,
        expenses: 12000,
      },
      { federal: data.federal()!, fica: data.fica()! },
      data.dependentCare()!,
    );
    expect(r.creditOnly.creditable.toNumber()).toBe(6000);
  });

  it("an early distribution at exactly 59½ owes no additional tax", () => {
    const r = earlyDistributionCost(
      {
        amount: 10000,
        age: 59.5,
        separatedAtSeparationAge: false,
        publicSafetySeparation: false,
        wholeException: false,
        emergency: false,
        otherExcepted: 0,
        federalTax: Money.zero(),
        stateTax: Money.zero(),
      },
      data.earlyDistribution()!,
    );
    expect(r.noAdditionalTaxBecause).toBe("age");
    expect(r.additionalTax.toNumber()).toBe(0);
  });

  it("a survivor born in a row's last year takes that row's full retirement age", () => {
    const rules = data.ssFamilyBenefits()!;
    const row = rules.survivorFullRetirementAge.find((r) => r.bornThrough !== null)!;
    expect(survivorFraMonths(row.bornThrough!, rules)).toBe(row.months);
  });

  it("PMI: a line first reached on the loan's last payment is reached", () => {
    // $12,000 at 0% over a year pays $1,000 a month and reaches $0 on payment 12.
    const r = pmiEndDates({
      originalValue: 20000,
      loanAmount: 12000,
      annualRatePct: 0,
      termYears: 1,
      extraMonthly: 0,
      requestShare: 0,
      automaticShare: 0,
    });
    expect(r.automatic).toEqual({ payment: 12 });
  });

  it("§221: the whole deduction at the phase-out's start, none at its end", () => {
    const rules = data.studentLoans()!;
    expect(interestDeduction(2500, 85000, false, rules)).toBe(2500);
    expect(interestDeduction(2500, 100000, false, rules)).toBe(0);
    expect(interestDeduction(2500, 92500, false, rules)).toBe(1250);
  });

  it("SSI: reproduces SSA's own 2026 break-even points (POMS SI 00810.350)", () => {
    // SSA: "2 FBR + $85 = monthly earned income break-even amount" and
    // "FBR + $20 = monthly unearned income break-even amount", with the 2026
    // exhibit at $2,073 / $3,067 earned and $1,014 / $1,511 unearned. At each
    // the federal payment is exactly zero; a dollar under, it is not.
    const rules = data.ssi()!;
    const pay = (couple: boolean, earned: number, unearned: number) =>
      ssiEstimate(
        { couple, earned, unearned, student: false, resources: 0 },
        rules,
      ).payment.toNumber();
    expect(pay(false, 2073, 0)).toBe(0);
    expect(pay(true, 3067, 0)).toBe(0);
    expect(pay(false, 0, 1014)).toBe(0);
    expect(pay(true, 0, 1511)).toBe(0);
    expect(pay(false, 2072, 0)).toBe(0.5);
    expect(pay(false, 0, 1013)).toBe(1);
  });
});
