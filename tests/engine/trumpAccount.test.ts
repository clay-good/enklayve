import { describe, it, expect } from "vitest";
import { projectTrumpAccount } from "../../src/engine/trumpAccount";
import { loadDatasets } from "../helpers/datasets";
import { TrumpAccountSchema, type TrumpAccountData } from "../../src/data/schemas";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * IRC §530A accounts.
 *
 * The One Big Beautiful Bill Act's account for a child under 18, open for
 * contributions since July 4, 2026. Three of its rules are the account rather
 * than trim, and each one is a case here: the $5,000 cap, the §6434 birth-year
 * window that ends, and the treatment as a traditional IRA under §408(a), which
 * makes the headline balance partly a future tax bill.
 */
const DATA: TrumpAccountData = TrumpAccountSchema.parse(
  JSON.parse(
    readFileSync(resolve(__dirname, "..", "..", "data", "trump-accounts-2026.json"), "utf8"),
  ),
);

const BASE = {
  currentAge: 0,
  birthYear: 2026,
  annualContribution: 1000,
  currentBalance: 0,
  annualReturnRate: 0.07,
};

describe("the statutory limits", () => {
  it("caps a contribution at $5,000 and says it did", () => {
    // §530A(c)(2)(A). A projection that quietly accepts $10,000 a year is
    // projecting an account nobody may open.
    const over = projectTrumpAccount({ ...BASE, annualContribution: 10_000 }, DATA);
    expect(over.contributionApplied.toNumber()).toBe(5000);
    expect(over.contributionWasCapped).toBe(true);
    const under = projectTrumpAccount(BASE, DATA);
    expect(under.contributionApplied.toNumber()).toBe(1000);
    expect(under.contributionWasCapped).toBe(false);
  });

  it("pays the $1,000 only inside the §6434 birth window", () => {
    // "born after December 31, 2024, and before January 1, 2029".
    for (const birthYear of [2025, 2026, 2027, 2028]) {
      expect(projectTrumpAccount({ ...BASE, birthYear }, DATA).pilotContribution.toNumber()).toBe(
        1000,
      );
    }
    for (const birthYear of [2024, 2029]) {
      const r = projectTrumpAccount({ ...BASE, birthYear }, DATA);
      expect(r.pilotContribution.toNumber()).toBe(0);
      expect(r.pilotEligible).toBe(false);
    }
  });

  it("counts the years to 18 and stops there", () => {
    expect(projectTrumpAccount({ ...BASE, currentAge: 0 }, DATA).yearsToDistribution).toBe(18);
    expect(projectTrumpAccount({ ...BASE, currentAge: 17 }, DATA).yearsToDistribution).toBe(1);
    // §530A(b)(1)(C)(ii): nothing before the year they turn 18, and this does
    // not project past it either — an 18-year-old's account is an IRA now.
    expect(projectTrumpAccount({ ...BASE, currentAge: 18 }, DATA).yearsToDistribution).toBe(0);
    expect(projectTrumpAccount({ ...BASE, currentAge: 25 }, DATA).yearsToDistribution).toBe(0);
  });
});

describe("what the account is worth, and what of it is the family's", () => {
  it("grows the seed and the contributions together", () => {
    // $1,000 seed at 7% for 18 years is 1000 × 1.07^18 = $3,379.93; $1,000 a
    // year for 18 years at 7% is 1000 × (1.07^18 − 1)/0.07 = $33,999.03.
    const r = projectTrumpAccount(BASE, DATA);
    expect(r.balanceAtDistribution.toNumber()).toBeCloseTo(3379.93 + 33_999.03, 1);
    expect(r.totalContributed.toNumber()).toBe(18_000 + 1000);
  });

  it("treats the seed and every dollar of growth as taxable", () => {
    // §530A(a) makes it a §408(a) account, so withdrawals are ordinary income;
    // §530A(d)(2) keeps the §6434 payment out of the investment in the
    // contract, so it carries no basis. Only the family's own $18,000 does.
    const r = projectTrumpAccount(BASE, DATA);
    expect(r.taxableAtDistribution.toNumber()).toBeCloseTo(
      r.balanceAtDistribution.toNumber() - 18_000,
      6,
    );
    // Which is most of it: this is a tax-deferred account, not a Roth.
    expect(r.taxableAtDistribution.toNumber()).toBeGreaterThan(
      r.balanceAtDistribution.toNumber() / 2,
    );
  });

  it("never reports a negative taxable amount, whatever the return", () => {
    // A negative return leaves less than was put in. There is no such thing as
    // negative taxable income here, and a minus sign on that line would read as
    // a refund.
    const r = projectTrumpAccount({ ...BASE, annualReturnRate: -0.5 }, DATA);
    expect(r.taxableAtDistribution.toNumber()).toBe(0);
  });

  it("is the plain sum when nothing grows", () => {
    const r = projectTrumpAccount({ ...BASE, annualReturnRate: 0 }, DATA);
    expect(r.balanceAtDistribution.toNumber()).toBe(19_000);
    expect(r.taxableAtDistribution.toNumber()).toBe(1000);
  });
});

describe("the bundled shard", () => {
  it("carries the figures the Code sets", async () => {
    const ds = await loadDatasets();
    expect(ds).toBeDefined();
    expect(DATA.annualContributionLimit).toBe(5000);
    expect(DATA.pilotContribution).toBe(1000);
    expect(DATA.pilotBirthYearFirst).toBe(2025);
    expect(DATA.pilotBirthYearLast).toBe(2028);
    expect(DATA.distributionAge).toBe(18);
    expect(DATA.contributionsOpenFrom).toBe("2026-07-04");
  });
});
