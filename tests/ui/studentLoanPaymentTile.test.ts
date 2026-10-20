import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { ibrMonthly, rapMonthly, rapOutcome, standardYears } from "../../src/engine/studentLoans";
import { studentLoanPaymentTile } from "../../src/tiles/studentLoanPayment";
import { mountStudentLoanPayment } from "../../src/tiles/studentLoanPaymentView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { StudentLoansData } from "../../src/data/schemas";
import type { TileContext } from "../../src/tiles/types";

/**
 * Federal Student Loan Payment (SPEC-5 Phase 33), worked by hand from
 * 20 U.S.C. §§1087e(q), 1087e(d)(7) and 1098e.
 */
let data: BundledData;
let rules: StudentLoansData;
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("student-loans-2026");
  rules = data.studentLoans()!;
});

describe("the Repayment Assistance Plan", () => {
  it("reproduces §1087e(q)(4)(B)'s tiers, floor and dependent reduction", () => {
    // $120 a year up to $10,000; above it, a share of ALL AGI, divided by 12.
    expect(rapMonthly(9000, 0, rules)).toBe(10);
    expect(rapMonthly(10001, 0, rules)).toBe(10); // 1% is $8.33, under the floor
    expect(rapMonthly(20000, 0, rules)).toBe(16.67); // 1% of $20,000
    expect(rapMonthly(55000, 0, rules)).toBe(229.17); // 5%
    expect(rapMonthly(120000, 0, rules)).toBe(1000); // 10%
    expect(rapMonthly(20000, 2, rules)).toBe(10); // $16.67 - $100, floored
    expect(rapMonthly(55000, 2, rules)).toBe(129.17);
    expect(rapMonthly(120000, 2, rules)).toBe(900);
  });

  it("waives unpaid interest and still takes $50 off principal each month", () => {
    // $50,000 at 7% accrues about $292 a month; $30,000 of AGI pays 2%, $50.
    // Each payment is all interest, the rest is not charged, and the match
    // takes $50 off principal: $18,000 over 360 payments, $32,000 cancelled.
    const r = rapOutcome(
      {
        balance: 50000,
        ratePct: 7,
        agi: 30000,
        dependents: 0,
        familySize: 1,
        incomeGrowth: 0,
        newBorrower2014: true,
      },
      rules,
    );
    expect(r.monthlyNow).toBe(50);
    expect(r.months).toBe(360);
    expect(r.totalPaid).toBe(18000);
    expect(r.forgiven).toBe(32000);
  });
});

describe("the Tiered Standard plan and income-based repayment", () => {
  it("sets the Standard term from principal at each breakpoint", () => {
    expect([24999, 25000, 49999, 50000, 99999, 100000].map((p) => standardYears(p, rules))).toEqual(
      [10, 15, 15, 20, 20, 25],
    );
  });

  it("takes 15% or 10% of income above 150% of the poverty line, capped at the 10-year payment", () => {
    const fpl = data.fpl("contiguous")!;
    // One person: 150% of $15,960 is $23,940. $60,000 leaves $36,060.
    expect(ibrMonthly(60000, 1, false, 200000, 6, rules, fpl)).toBe(450.75);
    expect(ibrMonthly(60000, 1, true, 200000, 6, rules, fpl)).toBe(300.5);
    // $20,000 at 6% over 10 years is $222.04, under either share.
    expect(ibrMonthly(60000, 1, false, 20000, 6, rules, fpl)).toBe(222.04);
  });
});

function mount(params: URLSearchParams): HTMLElement {
  const root = document.createElement("div");
  mountStudentLoanPayment({
    root,
    params,
    setParams: () => {},
    permalink: () => "",
    navigate: () => {},
    locale: "en-US",
    data,
    profile: new SituationStore(),
  } as TileContext);
  return root;
}

describe("Federal Student Loan Payment", () => {
  it("shows RAP beside IBR for older loans, and beside Standard for a new one", () => {
    const old = mount(new URLSearchParams({ bal: "38000", rate: "6.5", agi: "52000", size: "1" }));
    const plans = (r: HTMLElement) =>
      Array.from(r.querySelectorAll(".slp-row th")).map((n) => n.textContent);
    expect(plans(old)).toEqual(["Repayment Assistance Plan", "Income-based repayment"]);
    const fresh = mount(new URLSearchParams({ bal: "38000", rate: "6.5", agi: "52000", new: "1" }));
    expect(plans(fresh)).toEqual(["Repayment Assistance Plan", "Standard (tiered)"]);
  });

  it("gives a SAVE borrower the 2028 deadline and no SAVE payment", () => {
    const root = mount(
      new URLSearchParams({ bal: "38000", rate: "6.5", agi: "52000", cur: "save" }),
    );
    expect(root.querySelector("[data-deadline]")).not.toBeNull();
    expect(root.querySelector("[data-deadline] a")?.getAttribute("href")).toContain("1087e");
    const plans = Array.from(root.querySelectorAll(".slp-row th")).map((n) => n.textContent);
    expect(plans.some((p) => p?.includes("SAVE"))).toBe(false);
  });

  it("never names a plan as the choice", () => {
    for (const params of [
      new URLSearchParams({ bal: "38000", rate: "6.5", agi: "52000" }),
      new URLSearchParams({ bal: "150000", rate: "7", agi: "30000", deps: "2", new: "1" }),
    ]) {
      const text = (mount(params).textContent ?? "").toLowerCase();
      expect(text).not.toMatch(/\b(best|recommend|you should (choose|pick)|cheapest plan)\b/);
    }
  });

  it("declares harm tier 2 with the advice line", async () => {
    await studentLoanPaymentTile.loadHow!();
    expect(studentLoanPaymentTile.harmTier).toBe(2);
    expect(checkHarmTier([studentLoanPaymentTile as AuditTile])).toEqual([]);
  });

  it("has no axe violations", async () => {
    const root = mount(
      new URLSearchParams({ bal: "38000", rate: "6.5", agi: "52000", cur: "paye" }),
    );
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
